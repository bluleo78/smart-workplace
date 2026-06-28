package com.workplace.mail.service;

import static com.workplace.jooq.Tables.EMAIL_ACCOUNT;
import static com.workplace.jooq.Tables.EMAIL_FOLDER;
import static com.workplace.jooq.Tables.EMAIL_MESSAGE;
import static com.workplace.jooq.Tables.ISSUE;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.workplace.global.tenant.TenantContext;
import com.workplace.issue.repository.IssueRepository;
import com.workplace.mail.dto.PromoteToIssueRequest;
import com.workplace.mail.dto.PromotedIssue;
import com.workplace.project.dto.CreateProjectRequest;
import com.workplace.project.service.ProjectService;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.TestFixtures;
import java.util.List;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

/** #520 메일→이슈 승격 — 사용자 권한 생성 + source 스탬프 + 멤버십 가드. */
class MailIssueServiceTest extends IntegrationTestBase {

  @Autowired MailIssueService mailIssueService;
  @Autowired IssueRepository issueRepository;
  @Autowired ProjectService projectService;
  @Autowired DSLContext dsl;

  /** AfterEach 에서 RLS-safe 정리용 — 생성된 이슈 id 기록. */
  private final java.util.List<Long> createdIssueIds = new java.util.ArrayList<>();

  /** AfterEach 에서 정리용 — 생성된 메일 계정 id 기록. */
  private final java.util.List<Long> createdAccountIds = new java.util.ArrayList<>();

  private long callerId;
  private String projectKey;

  @BeforeEach
  void setUp() {
    callerId = TestFixtures.createHuman(dsl);
    TenantContext.set(1L);
    String suffix = UUID.randomUUID().toString().replaceAll("-", "").toUpperCase().substring(0, 4);
    String raw = "MI" + suffix;
    projectKey = raw.substring(0, Math.min(10, raw.length()));
    // projectService.create 는 @Transactional — TenantContext.set 아래에서 GUC 주입
    projectService.create(callerId, new CreateProjectRequest(projectKey, "메일이슈 테스트", "x"));
  }

  @AfterEach
  void tearDown() {
    // 공유 test DB 누수 방지 — RLS-안전 정리
    cleanupInTenant(
        1L,
        () -> {
          if (!createdIssueIds.isEmpty()) {
            dsl.deleteFrom(ISSUE).where(ISSUE.ID.in(createdIssueIds)).execute();
          }
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
   * 테스트용 메일 메시지를 caller 소유 계정에 삽입하고 messageId 반환.
   *
   * <p>MailIssueService 는 messageId 소유 검증을 수행하지 않으므로(Task 4 에서 추가 예정) 메시지 행 삽입만으로 충분하다. 향후 소유 검증
   * 추가를 대비해 caller 소유 계정으로 삽입한다. cleanupInTenant tx 안에서 삽입해 GUC(tenant_id)를 주입한다.
   */
  private long seedMailMessage(long userId) {
    // baseDsl 로 직접 삽입 — MailTestSupport.seedUnseenGraphMessage 패턴 참조
    // EMAIL_ACCOUNT 의 tenant_id 는 GUC DEFAULT; cleanupInTenant 가 GUC 주입 tx 를 제공
    long[] ids = new long[2]; // [0]=accountId, [1]=messageId
    cleanupInTenant(
        1L,
        () -> {
          String suffix = UUID.randomUUID().toString().substring(0, 8);
          long accountId =
              dsl.insertInto(EMAIL_ACCOUNT)
                  .set(EMAIL_ACCOUNT.USER_ID, userId)
                  .set(EMAIL_ACCOUNT.EMAIL_ADDRESS, "seed-" + suffix + "@test.local")
                  .set(EMAIL_ACCOUNT.DISPLAY_NAME, "씨드계정")
                  .returning(EMAIL_ACCOUNT.ID)
                  .fetchOne()
                  .getId();
          createdAccountIds.add(accountId);
          ids[0] = accountId;

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
          ids[1] = messageId;
        });
    return ids[1];
  }

  @Test
  void promoteToIssue_createsIssueAndStampsMailSource() {
    long messageId = seedMailMessage(callerId);

    PromotedIssue result =
        mailIssueService.promoteToIssue(
            callerId,
            messageId,
            new PromoteToIssueRequest(projectKey, "정산 자료 검토", "메일 요청 정리", "HIGH", List.of()));

    assertThat(result.issueKey()).startsWith(projectKey + "-");
    assertThat(issueRepository.findSourceIssueKey("MAIL", messageId)).contains(result.issueKey());

    // AfterEach 정리를 위해 생성된 이슈 id 수집(SOURCE_TYPE/SOURCE_ID 로 역조회)
    cleanupInTenant(
        1L,
        () -> {
          Long issueId =
              dsl.select(ISSUE.ID)
                  .from(ISSUE)
                  .where(ISSUE.SOURCE_TYPE.eq("MAIL").and(ISSUE.SOURCE_ID.eq(messageId)))
                  .fetchOneInto(Long.class);
          if (issueId != null) createdIssueIds.add(issueId);
        });
  }

  @Test
  void findLinkedIssue_afterPromote_returnsKey() {
    long messageId = seedMailMessage(callerId);
    var promoted =
        mailIssueService.promoteToIssue(
            callerId,
            messageId,
            new PromoteToIssueRequest(projectKey, "t", null, "MID", List.of()));

    // AfterEach 정리를 위해 생성된 이슈 id 수집
    cleanupInTenant(
        1L,
        () -> {
          Long issueId =
              dsl.select(ISSUE.ID)
                  .from(ISSUE)
                  .where(ISSUE.SOURCE_TYPE.eq("MAIL").and(ISSUE.SOURCE_ID.eq(messageId)))
                  .fetchOneInto(Long.class);
          if (issueId != null) createdIssueIds.add(issueId);
        });

    assertThat(mailIssueService.findLinkedIssue(callerId, messageId).issueKey())
        .isEqualTo(promoted.issueKey());
  }

  @Test
  void findLinkedIssue_none_returnsNull() {
    long messageId = seedMailMessage(callerId);
    assertThat(mailIssueService.findLinkedIssue(callerId, messageId).issueKey()).isNull();
  }

  @Test
  void promoteToIssue_nonMemberProject_rejected() {
    long messageId = seedMailMessage(callerId);

    assertThatThrownBy(
            () ->
                mailIssueService.promoteToIssue(
                    callerId,
                    messageId,
                    new PromoteToIssueRequest("NOPE", "x", null, "MID", List.of())))
        .isInstanceOf(RuntimeException.class); // accessGuard.assertMember → 권한/404 계열
  }
}
