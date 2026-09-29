package com.workplace.mail.outbound;

import static com.workplace.jooq.Tables.EMAIL_ACCOUNT;
import static com.workplace.jooq.Tables.EMAIL_FOLDER;
import static com.workplace.jooq.Tables.EMAIL_MESSAGE;
import static com.workplace.jooq.Tables.ISSUE;
import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.after;
import static org.mockito.Mockito.clearInvocations;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.workplace.global.outbound.AiAgentEventClient;
import com.workplace.global.realtime.SseRegistry;
import com.workplace.global.tenant.TenantContext;
import com.workplace.mail.dto.EmailAccountResponse;
import com.workplace.mail.dto.MailProvider;
import com.workplace.mail.dto.MailSyncResult;
import com.workplace.mail.dto.PromoteToIssueRequest;
import com.workplace.mail.service.EmailAccountService;
import com.workplace.mail.service.MailBackfillService;
import com.workplace.mail.service.MailFetcher;
import com.workplace.mail.service.MailIssueService;
import com.workplace.mail.service.MailMessageService;
import com.workplace.mail.service.MailSyncService;
import com.workplace.project.dto.CreateProjectRequest;
import com.workplace.project.service.ProjectService;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.ResourceChangedCapture;
import com.workplace.support.ResourceChangedCapture.Captured;
import com.workplace.support.TestFixtures;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.util.ReflectionTestUtils;

/**
 * WP-64 통합 — 메일·메일 계정·메일 동기화 변경 → AFTER_COMMIT resource.changed 수신자 검증. AFTER_COMMIT 발화를 위해
 * 클래스에 @Transactional 을 붙이지 않는다(커밋된 행은 @AfterEach 에서 회수).
 */
@DisplayName("메일 변경 → resource.changed fan-out 통합")
class MailResourceChangedIntegrationTest extends IntegrationTestBase {

  @MockitoBean SseRegistry registry;
  @MockitoBean AiAgentEventClient aiClient; // ai-agent 실제 호출 차단
  @MockitoBean MailBackfillService backfillService; // 동기화 후 본문 보충 트리거 무동작화

  @Autowired DSLContext dsl;
  @Autowired MailMessageService messageService;
  @Autowired MailIssueService issueService;
  @Autowired EmailAccountService accountService;
  @Autowired MailSyncService syncService;
  @Autowired ProjectService projectService;

  private final List<Long> accountIds = new ArrayList<>();
  private final List<Long> issueSourceIds = new ArrayList<>();
  private long owner;
  private long accountId;
  private long messageId;

  @BeforeEach
  void seed() {
    TenantContext.set(1L);
    owner = TestFixtures.createHuman(dsl);
    long[] ids = seedAccountAndMessage(owner);
    accountId = ids[0];
    messageId = ids[1];
  }

  @AfterEach
  void cleanup() {
    cleanupInTenant(
        1L,
        () -> {
          dsl.deleteFrom(ISSUE)
              .where(ISSUE.SOURCE_TYPE.eq("MAIL").and(ISSUE.SOURCE_ID.in(issueSourceIds)))
              .execute();
          dsl.deleteFrom(EMAIL_MESSAGE).where(EMAIL_MESSAGE.ACCOUNT_ID.in(accountIds)).execute();
          dsl.deleteFrom(EMAIL_FOLDER).where(EMAIL_FOLDER.ACCOUNT_ID.in(accountIds)).execute();
          dsl.deleteFrom(EMAIL_ACCOUNT).where(EMAIL_ACCOUNT.ID.in(accountIds)).execute();
        });
    accountIds.clear();
    issueSourceIds.clear();
    TenantContext.clear();
  }

  /** 소유자 계정 + INBOX 폴더 + 메시지 1건을 커밋 상태로 시드한다. [accountId, messageId] 반환. */
  private long[] seedAccountAndMessage(long userId) {
    long[] ids = new long[2];
    cleanupInTenant(
        1L,
        () -> {
          String s = UUID.randomUUID().toString().substring(0, 8);
          long acc =
              dsl.insertInto(EMAIL_ACCOUNT)
                  .set(EMAIL_ACCOUNT.USER_ID, userId)
                  .set(EMAIL_ACCOUNT.EMAIL_ADDRESS, "rc-" + s + "@test.local")
                  .set(EMAIL_ACCOUNT.DISPLAY_NAME, "rc계정")
                  .returning(EMAIL_ACCOUNT.ID)
                  .fetchOne()
                  .getId();
          accountIds.add(acc);
          long folder =
              dsl.insertInto(EMAIL_FOLDER)
                  .set(EMAIL_FOLDER.ACCOUNT_ID, acc)
                  .set(EMAIL_FOLDER.NAME, "INBOX")
                  .returning(EMAIL_FOLDER.ID)
                  .fetchOne()
                  .getId();
          long msg =
              dsl.insertInto(EMAIL_MESSAGE)
                  .set(EMAIL_MESSAGE.ACCOUNT_ID, acc)
                  .set(EMAIL_MESSAGE.FOLDER_ID, folder)
                  .set(EMAIL_MESSAGE.PROVIDER_MESSAGE_ID, "m-" + s + "@test.local")
                  .set(EMAIL_MESSAGE.THREAD_ID, "t-" + s)
                  .set(EMAIL_MESSAGE.SEEN, false)
                  .returning(EMAIL_MESSAGE.ID)
                  .fetchOne()
                  .getId();
          ids[0] = acc;
          ids[1] = msg;
        });
    return ids;
  }

  /** resource/op 조합의 resource.changed 를 캡처해 (수신자, payload) 를 돌려준다 — 공용 헬퍼 위임. */
  private Captured capture(String resource, String op) {
    return ResourceChangedCapture.capture(registry, resource, op);
  }

  @Test
  @DisplayName("회신필요 처리완료는 소유자에게만, accountId·messageId 포함")
  void needsReplyDone_ownerOnly() {
    clearInvocations(registry);
    messageService.markNeedsReplyDone(owner, accountId, messageId);
    var c = capture("mail", "updated");
    assertThat(c.recipients()).containsExactly(owner);
    assertThat(c.payload().get("accountId")).isEqualTo(accountId);
    assertThat(c.payload().get("messageId")).isEqualTo(messageId);
  }

  @Test
  @DisplayName("메일→이슈 승격은 메시지 id 를 담은 mail updated 를 소유자에게")
  void promoteToIssue_publishesMailUpdatedWithMessageId() {
    String key = "MR" + UUID.randomUUID().toString().replace("-", "").toUpperCase().substring(0, 4);
    projectService.create(owner, new CreateProjectRequest(key, "메일 rc", "x"));
    issueSourceIds.add(messageId);
    clearInvocations(registry);
    issueService.promoteToIssue(
        owner, messageId, new PromoteToIssueRequest(key, "승격", null, "MID", List.of()));
    var c = capture("mail", "updated");
    assertThat(c.recipients()).contains(owner);
    assertThat(c.payload().get("accountId")).isEqualTo(accountId);
    assertThat(c.payload().get("messageId")).isEqualTo(messageId);
  }

  @Test
  @DisplayName("계정 삭제는 mail-account deleted 를 소유자에게")
  void accountDelete_publishesMailAccount() {
    clearInvocations(registry);
    accountService.delete(owner, accountId);
    var c = capture("mail-account", "deleted");
    assertThat(c.recipients()).containsExactly(owner);
    assertThat(c.payload().get("accountId")).isEqualTo(accountId);
  }

  /** 동기화 경로 — IMAP fetcher 를 가짜로 바꿔 끼운다(실제 IMAP 호출 차단). 반환 후 원복은 호출자가 한다. */
  @SuppressWarnings("unchecked")
  private MailFetcher swapImapFetcher(MailSyncResult result) {
    MailFetcher fake = mock(MailFetcher.class);
    when(fake.provider()).thenReturn(MailProvider.IMAP);
    when(fake.fetchNewMessages(
            org.mockito.ArgumentMatchers.anyLong(),
            org.mockito.ArgumentMatchers.anyLong(),
            org.mockito.ArgumentMatchers.any(EmailAccountResponse.class)))
        .thenReturn(result);
    var map =
        (Map<MailProvider, MailFetcher>) ReflectionTestUtils.getField(syncService, "fetchers");
    MailFetcher original = map.put(MailProvider.IMAP, fake);
    return original;
  }

  @SuppressWarnings("unchecked")
  private void restoreImapFetcher(MailFetcher original) {
    var map =
        (Map<MailProvider, MailFetcher>) ReflectionTestUtils.getField(syncService, "fetchers");
    map.put(MailProvider.IMAP, original);
  }

  @Test
  @DisplayName("동기화로 새 메일이 저장되면 소유자에게 actor 없이 발행")
  void sync_withSaved_publishesToOwnerWithoutActor() {
    MailFetcher original = swapImapFetcher(new MailSyncResult(1, 1));
    try {
      clearInvocations(registry);
      TenantContext.set(1L);
      syncService.sync(owner, accountId);
      var c = capture("mail", "updated");
      assertThat(c.recipients()).containsExactly(owner);
      assertThat(c.payload().get("accountId")).isEqualTo(accountId);
      assertThat(c.payload().get("actorId")).isNull();
      assertThat(c.payload()).doesNotContainKey("messageId");
    } finally {
      restoreImapFetcher(original);
    }
  }

  @Test
  @DisplayName("동기화로 저장된 게 없으면 발행하지 않음")
  void sync_withNothingSaved_publishesNothing() {
    MailFetcher original = swapImapFetcher(new MailSyncResult(3, 0));
    try {
      clearInvocations(registry);
      TenantContext.set(1L);
      syncService.sync(owner, accountId);
      verify(registry, after(500).never())
          .fanOut(
              org.mockito.ArgumentMatchers.any(),
              eq("resource.changed"),
              org.mockito.ArgumentMatchers.any());
    } finally {
      restoreImapFetcher(original);
    }
  }
}
