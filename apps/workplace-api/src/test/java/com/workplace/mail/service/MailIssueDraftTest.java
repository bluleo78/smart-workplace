package com.workplace.mail.service;

import static com.workplace.jooq.Tables.EMAIL_ACCOUNT;
import static com.workplace.jooq.Tables.EMAIL_FOLDER;
import static com.workplace.jooq.Tables.EMAIL_MESSAGE;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.when;

import com.workplace.auth.service.AssistantResolver;
import com.workplace.auth.service.AssistantSpec;
import com.workplace.global.tenant.TenantContext;
import com.workplace.mail.dto.MailIssueDraft;
import com.workplace.mail.exception.EmailMessageNotFoundException;
import com.workplace.mail.outbound.AiAgentMailClient;
import com.workplace.mail.outbound.MailAiMessages;
import com.workplace.project.dto.CreateProjectRequest;
import com.workplace.project.service.ProjectService;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.TestFixtures;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.mock.mockito.MockBean;

/** #520 메일 이슈 초안 — RLS-safe 컨텍스트 조회 + 후보 프로젝트 포함 + ai-agent 응답 매핑 + 소유권 가드 통합 테스트. */
class MailIssueDraftTest extends IntegrationTestBase {

  @Autowired MailIssueService mailIssueService;
  @Autowired ProjectService projectService;
  @Autowired DSLContext dsl;

  /** ai-agent HTTP 목(실 HTTP 호출 없음). */
  @MockBean AiAgentMailClient mailClient;

  /** AssistantResolver 목(비서 미설정 환경에서도 통과). */
  @MockBean AssistantResolver assistantResolver;

  /** 테스트용 고정 AssistantSpec. */
  private static final AssistantSpec MOCK_SPEC =
      new AssistantSpec(999L, "claude-sonnet-4-6", "NONE", 1, 60_000);

  private long callerId;
  private String projectKey;

  private final List<Long> createdAccountIds = new ArrayList<>();

  @BeforeEach
  void setUp() {
    callerId = TestFixtures.createHuman(dsl);
    TenantContext.set(1L);
    String suffix = UUID.randomUUID().toString().replaceAll("-", "").toUpperCase().substring(0, 4);
    String raw = "ID" + suffix;
    projectKey = raw.substring(0, Math.min(10, raw.length()));
    projectService.create(callerId, new CreateProjectRequest(projectKey, "이슈초안 테스트", "x"));
    when(assistantResolver.resolve(callerId)).thenReturn(MOCK_SPEC);
  }

  @AfterEach
  void tearDown() {
    cleanupInTenant(
        1L,
        () -> {
          if (!createdAccountIds.isEmpty()) {
            dsl.deleteFrom(EMAIL_MESSAGE)
                .where(EMAIL_MESSAGE.ACCOUNT_ID.in(createdAccountIds))
                .execute();
            dsl.deleteFrom(EMAIL_FOLDER)
                .where(EMAIL_FOLDER.ACCOUNT_ID.in(createdAccountIds))
                .execute();
            dsl.deleteFrom(EMAIL_ACCOUNT).where(EMAIL_ACCOUNT.ID.in(createdAccountIds)).execute();
          }
        });
    TenantContext.clear();
  }

  /**
   * caller 소유 메일 메시지를 삽입하고 messageId 반환.
   *
   * <p>ai_enabled 기본값이 false 이므로 EMAIL_ACCOUNT.AI_ENABLED = true 로 삽입해 requireEnabled 가드를 통과시킨다.
   */
  private long seedMailMessage(long userId) {
    long[] ids = new long[1];
    cleanupInTenant(
        1L,
        () -> {
          String suffix = UUID.randomUUID().toString().substring(0, 8);
          long accountId =
              dsl.insertInto(EMAIL_ACCOUNT)
                  .set(EMAIL_ACCOUNT.USER_ID, userId)
                  .set(EMAIL_ACCOUNT.EMAIL_ADDRESS, "seed-" + suffix + "@test.local")
                  .set(EMAIL_ACCOUNT.DISPLAY_NAME, "씨드계정")
                  .set(EMAIL_ACCOUNT.AI_ENABLED, true)
                  .returning(EMAIL_ACCOUNT.ID)
                  .fetchOne()
                  .getId();
          createdAccountIds.add(accountId);

          long folderId =
              dsl.insertInto(EMAIL_FOLDER)
                  .set(EMAIL_FOLDER.ACCOUNT_ID, accountId)
                  .set(EMAIL_FOLDER.NAME, "INBOX")
                  .onConflictDoNothing()
                  .returning(EMAIL_FOLDER.ID)
                  .fetchOne()
                  .getId();

          long messageId =
              dsl.insertInto(EMAIL_MESSAGE)
                  .set(EMAIL_MESSAGE.ACCOUNT_ID, accountId)
                  .set(EMAIL_MESSAGE.FOLDER_ID, folderId)
                  .set(EMAIL_MESSAGE.PROVIDER_MESSAGE_ID, "msg-" + suffix + "@test.local")
                  .set(EMAIL_MESSAGE.THREAD_ID, "thread-" + suffix)
                  .set(EMAIL_MESSAGE.SEEN, false)
                  .returning(EMAIL_MESSAGE.ID)
                  .fetchOne()
                  .getId();
          ids[0] = messageId;
        });
    return ids[0];
  }

  /** draftIssue: AI 응답이 후보 projectKey 면 suggestedProjectKey 에 그대로 반환. */
  @Test
  void draftIssue_returnsDraftWithCandidateProjects() {
    long messageId = seedMailMessage(callerId);
    when(mailClient.issueDraft(any()))
        .thenReturn(new MailAiMessages.IssueDraftResult("정산 검토", "- 5월 자료", "HIGH", projectKey));

    MailIssueDraft draft = mailIssueService.draftIssue(callerId, messageId);

    assertThat(draft.title()).isEqualTo("정산 검토");
    assertThat(draft.priority()).isEqualTo("HIGH");
    assertThat(draft.suggestedProjectKey()).isEqualTo(projectKey);
    assertThat(draft.candidateProjects()).anyMatch(p -> p.key().equals(projectKey));
  }

  /** draftIssue: AI 가 후보에 없는 projectKey 를 추천하면 suggestedProjectKey 는 null. */
  @Test
  void draftIssue_unknownSuggestedProject_ignored() {
    long messageId = seedMailMessage(callerId);
    when(mailClient.issueDraft(any()))
        .thenReturn(new MailAiMessages.IssueDraftResult("정산 검토", "- 5월 자료", "HIGH", "NOEXIST"));

    MailIssueDraft draft = mailIssueService.draftIssue(callerId, messageId);

    assertThat(draft.suggestedProjectKey()).isNull();
    assertThat(draft.candidateProjects()).anyMatch(p -> p.key().equals(projectKey));
  }

  /** draftIssue: 타 사용자의 메시지 접근 시 404. */
  @Test
  void draftIssue_notOwnedMessage_rejected() {
    long otherUser = TestFixtures.createHuman(dsl);
    long messageId = seedMailMessage(otherUser);

    assertThatThrownBy(() -> mailIssueService.draftIssue(callerId, messageId))
        .isInstanceOf(EmailMessageNotFoundException.class);
  }

  /** promoteToIssue: 타 사용자의 메시지로 승격 시도하면 거부. */
  @Test
  void promoteToIssue_notOwnedMessage_rejected() {
    long otherUser = TestFixtures.createHuman(dsl);
    long messageId = seedMailMessage(otherUser);

    assertThatThrownBy(
            () ->
                mailIssueService.promoteToIssue(
                    callerId,
                    messageId,
                    new com.workplace.mail.dto.PromoteToIssueRequest(
                        projectKey, "제목", null, "MID", List.of())))
        .isInstanceOf(EmailMessageNotFoundException.class);
  }
}
