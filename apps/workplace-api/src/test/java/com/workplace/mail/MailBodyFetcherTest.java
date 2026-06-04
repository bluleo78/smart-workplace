package com.workplace.mail;

import static com.workplace.jooq.Tables.EMAIL_MESSAGE;
import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.Mockito.when;

import com.icegreen.greenmail.configuration.GreenMailConfiguration;
import com.icegreen.greenmail.junit5.GreenMailExtension;
import com.icegreen.greenmail.util.GreenMailUtil;
import com.icegreen.greenmail.util.ServerSetupTest;
import com.workplace.auth.service.AssistantResolver;
import com.workplace.auth.service.AssistantSpec;
import com.workplace.global.security.EncryptionService;
import com.workplace.mail.dto.BodyTarget;
import com.workplace.mail.dto.EmailMessageDetail;
import com.workplace.mail.dto.EmailMessageSummary;
import com.workplace.mail.outbound.AiAgentMailClient;
import com.workplace.mail.outbound.MailAiMessages.ClassifyResult;
import com.workplace.mail.repository.EmailAccountRepository;
import com.workplace.mail.repository.EmailMessageRepository;
import com.workplace.mail.service.MailBodyFetcher;
import com.workplace.mail.service.MailSyncService;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.TestFixtures;
import java.util.List;
import org.jooq.DSLContext;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.RegisterExtension;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.transaction.annotation.Transactional;

/**
 * MailBodyFetcher 통합 테스트 — GreenMail(IMAP 3143)에서 단건 본문을 적재해 캐시(body_fetched_at)·본문·분류를 검증한다.
 *
 * <p>주의: 현재 sync 는 parser.parse 로 본문까지 채우므로(Task 7 전), '미적재' 상태를 재현하려면 sync 후 본문 컬럼을 비운다.
 * body_fetched_at 은 sync 가 건드리지 않아 null 유지 — fetchBody 가 실제로 본문을 다시 내려받는지 검증할 수 있다.
 */
@Transactional
class MailBodyFetcherTest extends IntegrationTestBase {

  @RegisterExtension
  static GreenMailExtension greenMail =
      new GreenMailExtension(ServerSetupTest.SMTP_IMAP)
          .withConfiguration(
              GreenMailConfiguration.aConfig().withUser("box@test.local", "box@test.local", "pw"));

  @Autowired DSLContext dsl;
  @Autowired MailSyncService syncService;
  @Autowired MailBodyFetcher bodyFetcher;
  @Autowired EmailAccountRepository accountRepo;
  @Autowired EmailMessageRepository messageRepo;
  @Autowired EncryptionService encryption;

  /** ai-agent 실호출 차단. */
  @MockitoBean AiAgentMailClient mailClient;

  /** 비서 해석 — 분류 테스트에서만 스텁. */
  @MockitoBean AssistantResolver assistantResolver;

  /** sync 후 본문을 비워 진짜 '미적재' 상태로 만든다(body_fetched_at 은 sync 가 건드리지 않아 null 유지). */
  private void clearBody(long messageId) {
    dsl.update(EMAIL_MESSAGE)
        .set(EMAIL_MESSAGE.BODY_TEXT, (String) null)
        .set(EMAIL_MESSAGE.BODY_HTML, (String) null)
        .set(EMAIL_MESSAGE.SNIPPET, (String) null)
        .where(EMAIL_MESSAGE.ID.eq(messageId))
        .execute();
  }

  @Test
  void fetchBody_본문적재_및_캐시() {
    long user = TestFixtures.createHuman(dsl);
    long accountId = MailTestSupport.insertAccount(accountRepo, encryption, user, false);
    GreenMailUtil.sendTextEmailTest("box@test.local", "alice@example.com", "제목", "본문입니다");
    greenMail.waitForIncomingEmail(1);

    syncService.sync(user, accountId);
    long messageId = messageRepo.listMissingBody(accountId, 10).get(0).messageId();
    clearBody(messageId); // 본문 제거 → fetchBody 가 실제로 다시 내려받는지 검증 가능

    bodyFetcher.fetchBody(user, messageRepo.findBodyTarget(accountId, messageId).orElseThrow());

    BodyTarget after = messageRepo.findBodyTarget(accountId, messageId).orElseThrow();
    assertThat(after.bodyFetchedAt()).isNotNull();
    EmailMessageDetail d = messageRepo.findDetailByIdAndUser(user, messageId).orElseThrow();
    assertThat(d.bodyText()).contains("본문입니다");
  }

  /** 이미 적재된 대상(body_fetched_at != null)은 no-op — IMAP 미접속. */
  @Test
  void fetchBody_이미적재면_noop() {
    long user = TestFixtures.createHuman(dsl);
    long accountId = MailTestSupport.insertAccount(accountRepo, encryption, user, false);
    GreenMailUtil.sendTextEmailTest("box@test.local", "alice@example.com", "제목", "본문입니다");
    greenMail.waitForIncomingEmail(1);

    syncService.sync(user, accountId);
    long messageId = messageRepo.listMissingBody(accountId, 10).get(0).messageId();
    // 1차 적재로 body_fetched_at 채움
    bodyFetcher.fetchBody(user, messageRepo.findBodyTarget(accountId, messageId).orElseThrow());
    BodyTarget loaded = messageRepo.findBodyTarget(accountId, messageId).orElseThrow();
    assertThat(loaded.bodyFetchedAt()).isNotNull();

    // 2차 호출은 가드로 즉시 return — 예외 없이 멱등
    bodyFetcher.fetchBody(user, loaded);
  }

  /** ai_enabled=true → 본문 적재 후 messageId 기반 분류 결과가 저장된다. */
  @Test
  void fetchBody_aiEnabled_분류기록() {
    long user = TestFixtures.createHuman(dsl);
    long accountId = MailTestSupport.insertAccount(accountRepo, encryption, user, true);
    GreenMailUtil.sendTextEmailTest("box@test.local", "sender@example.com", "업무 보고", "보고서 내용");
    greenMail.waitForIncomingEmail(1);

    syncService.sync(user, accountId);
    long messageId = messageRepo.listMissingBody(accountId, 10).get(0).messageId();
    clearBody(messageId);

    when(assistantResolver.resolve(anyLong()))
        .thenReturn(new AssistantSpec(5L, "claude-sonnet-4-6", "NORMAL", 8, 60000));
    when(mailClient.classify(any())).thenReturn(new ClassifyResult("업무", true));

    bodyFetcher.fetchBody(user, messageRepo.findBodyTarget(accountId, messageId).orElseThrow());

    List<EmailMessageSummary> list = messageRepo.listByAccount(accountId, null, 50);
    assertThat(list).hasSize(1);
    assertThat(list.get(0).aiCategory()).isEqualTo("업무");
    assertThat(list.get(0).aiNeedsReply()).isTrue();
  }
}
