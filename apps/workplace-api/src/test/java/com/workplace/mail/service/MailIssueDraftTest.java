package com.workplace.mail.service;

import static com.workplace.jooq.Tables.EMAIL_ACCOUNT;
import static com.workplace.jooq.Tables.EMAIL_FOLDER;
import static com.workplace.jooq.Tables.EMAIL_MESSAGE;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doReturn;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.workplace.auth.service.AssistantResolver;
import com.workplace.auth.service.AssistantSpec;
import com.workplace.global.ai.AiMemoryLine;
import com.workplace.global.ai.AiMemoryReader;
import com.workplace.global.ai.SharedAiMemoryReader;
import com.workplace.global.ai.SharedMemories;
import com.workplace.global.ai.SharedMemoryLine;
import com.workplace.global.tenant.TenantContext;
import com.workplace.mail.dto.MailIssueDraft;
import com.workplace.mail.exception.EmailMessageNotFoundException;
import com.workplace.mail.outbound.AiAgentMailClient;
import com.workplace.mail.outbound.MailAiMessages;
import com.workplace.project.dto.CreateProjectRequest;
import com.workplace.project.service.ProjectService;
import com.workplace.support.ExternalClientMockedTestBase;
import com.workplace.support.TestFixtures;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.beans.factory.annotation.Autowired;

/** #520 메일 이슈 초안 — RLS-safe 컨텍스트 조회 + 후보 프로젝트 포함 + ai-agent 응답 매핑 + 소유권 가드 통합 테스트. */
class MailIssueDraftTest extends ExternalClientMockedTestBase {

  @Autowired MailIssueService mailIssueService;
  @Autowired ProjectService projectService;
  @Autowired DSLContext dsl;

  /** ai-agent HTTP 목(실 HTTP 호출 없음). */
  @Autowired AiAgentMailClient mailClient;

  /** AssistantResolver 목(비서 미설정 환경에서도 통과). */
  @Autowired AssistantResolver assistantResolver;

  /** 메일 메모리(WP-381) — 공통 spy(IntegrationTestBase). 스텁하지 않으면 실제로 읽으며, 새 사용자는 메모리가 없어 빈 목록이다. */
  @Autowired AiMemoryReader memoryReader;

  /** 공용 메모리(WP-386) — 공통 spy(IntegrationTestBase). 스텁하지 않으면 실제로 읽는다. */
  @Autowired SharedAiMemoryReader sharedReader;

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

  /** WP-886 — ai-agent 가 보낸 5단계 우선순위(HIGHEST 포함)는 보정 없이 초안에 그대로 담긴다. */
  @Test
  void draftIssue_priority_fiveLevels_kept() {
    long messageId = seedMailMessage(callerId);
    when(mailClient.issueDraft(any()))
        .thenReturn(new MailAiMessages.IssueDraftResult("서버 장애", "- 즉시 확인", "HIGHEST", projectKey));
    assertThat(mailIssueService.draftIssue(callerId, messageId).priority()).isEqualTo("HIGHEST");
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

  /** WP-381: 메일 → 이슈 초안에는 공통 + 메일(MAIL) 메모리를 싣는다(이슈 범위가 아니다). */
  @Test
  void draftIssue_메일_메모리를_요청에_싣는다() {
    long messageId = seedMailMessage(callerId);
    List<AiMemoryLine> lines =
        List.of(new AiMemoryLine(6L, "CONTEXT", "정산 업무 담당", null, null, null));
    doReturn(lines).when(memoryReader).readForEntry(eq(callerId), eq(AiMemoryReader.MAIL), any());
    when(mailClient.issueDraft(any()))
        .thenReturn(new MailAiMessages.IssueDraftResult("정산 검토", "- 5월 자료", "HIGH", projectKey));

    mailIssueService.draftIssue(callerId, messageId);

    ArgumentCaptor<MailAiMessages.IssueDraftRequest> cap =
        ArgumentCaptor.forClass(MailAiMessages.IssueDraftRequest.class);
    verify(mailClient).issueDraft(cap.capture());
    assertThat(cap.getValue().memories()).isEqualTo(lines);
  }

  /** WP-386: 메일 → 이슈 초안에도 조직 공용 메모리를 싣는다. */
  @Test
  void draftIssue_조직_공용_메모리를_요청에_싣는다() {
    long messageId = seedMailMessage(callerId);
    var shared = new SharedMemories(List.of(new SharedMemoryLine("조직", "이슈 제목은 동사로 끝낸다")), 0);
    doReturn(shared).when(sharedReader).readForUser(callerId, null, null);
    when(mailClient.issueDraft(any()))
        .thenReturn(new MailAiMessages.IssueDraftResult("정산 검토", "- 5월 자료", "HIGH", projectKey));

    mailIssueService.draftIssue(callerId, messageId);

    ArgumentCaptor<MailAiMessages.IssueDraftRequest> cap =
        ArgumentCaptor.forClass(MailAiMessages.IssueDraftRequest.class);
    verify(mailClient).issueDraft(cap.capture());
    assertThat(cap.getValue().sharedMemories()).isEqualTo(shared.items());
  }
}
