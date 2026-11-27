package com.workplace.airun.capacity;

import static com.workplace.jooq.Tables.EMAIL_ACCOUNT;
import static com.workplace.jooq.Tables.EMAIL_CONTENT;
import static com.workplace.jooq.Tables.FILE;
import static com.workplace.jooq.Tables.FILE_EXTRACTION;
import static com.workplace.jooq.Tables.ISSUE;
import static com.workplace.jooq.Tables.ISSUE_ASSIGNEE;
import static com.workplace.jooq.Tables.ISSUE_LABEL;
import static com.workplace.jooq.Tables.LABEL;
import static com.workplace.jooq.Tables.PROJECT;
import static com.workplace.support.TestFixtures.uniqueProjectKey;
import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.fileai.repository.FileExtractionRepository;
import com.workplace.issue.dto.CreateIssueRequest;
import com.workplace.issue.repository.IssueRepository;
import com.workplace.issue.service.IssueService;
import com.workplace.mail.repository.EmailContentRepository;
import com.workplace.mail.repository.EmailMessageRepository;
import com.workplace.mail.service.MailAnalysisFixtures;
import com.workplace.project.dto.CreateProjectRequest;
import com.workplace.project.dto.ProjectResponse;
import com.workplace.project.service.ProjectService;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.TestFixtures;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.annotation.Transactional;

/**
 * WP-1830 AI 처리 표본용 세기 세 개(대기열 이슈·분류 대기 메일·요약 대기 파일) 통합 테스트. 테스트 DB 는 클래스끼리 공유되므로 대기열은 시험마다 유일한 라벨
 * 이름으로, 메일·파일은 시드 전 기준값 대비 증가분으로 확인한다.
 */
@Transactional
class AiCapacityCountsTest extends IntegrationTestBase {

  @Autowired DSLContext dsl;
  @Autowired IssueRepository issueRepo;
  @Autowired IssueService issueService;
  @Autowired ProjectService projectService;
  @Autowired EmailMessageRepository messageRepo;
  @Autowired EmailContentRepository contentRepo;
  @Autowired FileExtractionRepository fileExtractionRepo;

  @BeforeEach
  void tenant1() {
    useTenant(1L);
  }

  // ── 대기열 시드 헬퍼 ───────────────────────────────────────────────────────────

  private long human() {
    long id = TestFixtures.createHuman(dsl);
    grantUserRole(id);
    TestFixtures.activeMemberOfCurrentTenant(dsl, id);
    return id;
  }

  private ProjectResponse project(long owner) {
    String key = uniqueProjectKey("CQ");
    return projectService.create(owner, new CreateProjectRequest(key, "P-" + key, "x", "TEAM"));
  }

  /** 담당 없는 열린 이슈 하나. */
  private long issue(long owner, ProjectResponse p, String title) {
    long id =
        issueService
            .create(
                owner,
                p.key(),
                new CreateIssueRequest(title, "본문", null, null, null, null, null, null))
            .id();
    dsl.deleteFrom(ISSUE_ASSIGNEE).where(ISSUE_ASSIGNEE.ISSUE_ID.eq(id)).execute();
    return id;
  }

  private long label(ProjectResponse p, String name) {
    return dsl.insertInto(LABEL)
        .set(LABEL.PROJECT_ID, p.id())
        .set(LABEL.NAME, name)
        .set(LABEL.COLOR_TOKEN, "blue")
        .returning(LABEL.ID)
        .fetchOne()
        .getId();
  }

  private void attach(long issueId, long labelId, OffsetDateTime at) {
    dsl.insertInto(ISSUE_LABEL)
        .set(ISSUE_LABEL.ISSUE_ID, issueId)
        .set(ISSUE_LABEL.LABEL_ID, labelId)
        .set(ISSUE_LABEL.CREATED_AT, at)
        .execute();
  }

  private void assign(long issueId, long userId) {
    dsl.insertInto(ISSUE_ASSIGNEE)
        .set(ISSUE_ASSIGNEE.ISSUE_ID, issueId)
        .set(ISSUE_ASSIGNEE.USER_ID, userId)
        .set(ISSUE_ASSIGNEE.ASSIGNED_BY, userId)
        .execute();
  }

  @Test
  void queue_countsOnlyOpenUnassignedToAgent() {
    // 시험마다 유일한 이름 — 다른 클래스가 남긴 행과 섞이지 않는다. 조회 쪽 이름은 공백·대소문자를 달리한다.
    String name = "AI-Q-" + UUID.randomUUID().toString().substring(0, 8);
    long owner = human();
    var p = project(owner);
    long q = label(p, name);
    long other = label(p, name + "-other");
    OffsetDateTime older = OffsetDateTime.now().minusDays(3).withNano(0);
    OffsetDateTime newer = OffsetDateTime.now().minusDays(1).withNano(0);
    OffsetDateTime newest = OffsetDateTime.now().minusHours(1).withNano(0);

    long open = issue(owner, p, "열림+담당 없음");
    attach(open, q, newer);
    long withHuman = issue(owner, p, "열림+사람 담당");
    attach(withHuman, q, older);
    assign(withHuman, owner);
    long withAgent = issue(owner, p, "열림+AGENT 담당");
    // 센 이슈보다 더 이른 시각이어도 뺀 이슈의 라벨은 최솟값에 들어가면 안 된다.
    attach(withAgent, q, OffsetDateTime.now().minusDays(30).withNano(0));
    assign(withAgent, createAgentUser("cq-agent"));
    long done = issue(owner, p, "DONE");
    attach(done, q, OffsetDateTime.now().minusDays(20).withNano(0));
    dsl.update(ISSUE)
        .set(ISSUE.STATUS, "DONE")
        .set(ISSUE.STATUS_ID, TestFixtures.defaultStatusId(ISSUE.PROJECT_ID, "DONE"))
        .where(ISSUE.ID.eq(done))
        .execute();
    long deleted = issue(owner, p, "지움");
    attach(deleted, q, OffsetDateTime.now().minusDays(10).withNano(0));
    dsl.update(ISSUE)
        .set(ISSUE.DELETED_AT, OffsetDateTime.now())
        .where(ISSUE.ID.eq(deleted))
        .execute();
    long otherLabel = issue(owner, p, "다른 라벨");
    attach(otherLabel, other, OffsetDateTime.now().minusDays(40).withNano(0));
    // 같은 이슈에 대기열 라벨이 둘이어도 한 번만 센다 — 두 번째 라벨이 더 이르면 그 시각이 최솟값이 된다.
    long q2 = label(p, name + " ");
    attach(withHuman, q2, newest);

    var stats = issueRepo.countAgentQueue(List.of(" " + name.toLowerCase() + " ", name + " "));

    assertThat(stats.waiting()).isEqualTo(2);
    assertThat(stats.oldestLabeledAt()).isEqualTo(older);
  }

  @Test
  void queue_excludesIssuesOfDeletedProject() {
    String name = "AI-QD-" + UUID.randomUUID().toString().substring(0, 8);
    long owner = human();
    var live = project(owner);
    var dead = project(owner);
    long ql = label(live, name);
    long qd = label(dead, name);
    attach(issue(owner, live, "살아 있는 프로젝트"), ql, OffsetDateTime.now().minusDays(1).withNano(0));
    attach(issue(owner, dead, "지운 프로젝트"), qd, OffsetDateTime.now().minusDays(9).withNano(0));
    // 프로젝트 soft-delete 는 이슈를 정리하지 않는다 — 이슈는 그대로 남는다.
    dsl.update(PROJECT)
        .set(PROJECT.DELETED_AT, OffsetDateTime.now())
        .where(PROJECT.ID.eq(dead.id()))
        .execute();

    var stats = issueRepo.countAgentQueue(List.of(name));

    assertThat(stats.waiting()).isEqualTo(1);
    // 지운 프로젝트 이슈의 더 이른 라벨 시각은 최솟값에 들어가지 않는다.
    assertThat(stats.oldestLabeledAt()).isAfter(OffsetDateTime.now().minusDays(2));
  }

  @Test
  void queue_noLabels_zeroAndNull() {
    var stats = issueRepo.countAgentQueue(List.of());

    assertThat(stats.waiting()).isZero();
    assertThat(stats.oldestLabeledAt()).isNull();
  }

  // ── 메일 ──────────────────────────────────────────────────────────────────────

  /** 미분류 content 하나와 그것을 가리키는 INBOX envelope. */
  private long mailContent(MailAnalysisFixtures.Box box) {
    long c =
        MailAnalysisFixtures.content(
            dsl, contentRepo, MailAnalysisFixtures.SHORT_BODY, MailAnalysisFixtures.SHORT_BODY);
    MailAnalysisFixtures.envelope(dsl, box, c, "a@ext.com", box.address(), null);
    return c;
  }

  @Test
  void mail_countsSameRuleAsListUncategorized() {
    var box = MailAnalysisFixtures.mailbox(dsl, false);
    int base = messageRepo.countUncategorized(true);

    mailContent(box); // 미분류 — 셈
    long future = mailContent(box); // 다음 시도 미래 — 뺌
    dsl.update(EMAIL_CONTENT)
        .set(EMAIL_CONTENT.AI_CATEGORY_NEXT_ATTEMPT_AT, OffsetDateTime.now().plusHours(1))
        .where(EMAIL_CONTENT.ID.eq(future))
        .execute();
    long past = mailContent(box); // 다음 시도 지남 — 셈
    dsl.update(EMAIL_CONTENT)
        .set(EMAIL_CONTENT.AI_CATEGORY_NEXT_ATTEMPT_AT, OffsetDateTime.now().minusHours(1))
        .where(EMAIL_CONTENT.ID.eq(past))
        .execute();
    long categorized = mailContent(box); // 분류됨 — 뺌
    dsl.update(EMAIL_CONTENT)
        .set(EMAIL_CONTENT.AI_CATEGORY, "업무")
        .where(EMAIL_CONTENT.ID.eq(categorized))
        .execute();
    long stamped = mailContent(box); // ai_categorized_at 채워짐 — 뺌
    dsl.update(EMAIL_CONTENT)
        .set(EMAIL_CONTENT.AI_CATEGORIZED_AT, OffsetDateTime.now())
        .where(EMAIL_CONTENT.ID.eq(stamped))
        .execute();

    assertThat(messageRepo.countUncategorized(true) - base).isEqualTo(2);
    // 계정 단위 목록과 같은 규칙인지 — 이 계정의 대표 envelope 도 2통이다.
    assertThat(messageRepo.listUncategorizedIds(box.accountId(), 100)).hasSize(2);
  }

  @Test
  void mail_excludesDisabledAccount() {
    var box = MailAnalysisFixtures.mailbox(dsl, true);
    int base = messageRepo.countUncategorized(true);
    mailContent(box);
    assertThat(messageRepo.countUncategorized(true) - base).isEqualTo(1);

    // 연결이 끊긴 계정은 백필이 돌지 않으므로(findActiveForSync) 세지 않는다.
    dsl.update(EMAIL_ACCOUNT)
        .set(EMAIL_ACCOUNT.DISABLED_AT, OffsetDateTime.now())
        .where(EMAIL_ACCOUNT.ID.eq(box.accountId()))
        .execute();

    assertThat(messageRepo.countUncategorized(true)).isEqualTo(base);
  }

  @Test
  void mail_withoutWorkspaceAssistant_countsOnlyAiEnabledAccounts() {
    var off = MailAnalysisFixtures.mailbox(dsl, false);
    var on = MailAnalysisFixtures.mailbox(dsl, true);
    int baseNoWs = messageRepo.countUncategorized(false);
    int baseWs = messageRepo.countUncategorized(true);

    mailContent(off);
    mailContent(on);

    // 워크스페이스 비서가 없으면 AI 꺼진 계정 메일은 분류되지 않으므로 뺀다. 있으면 둘 다 센다.
    assertThat(messageRepo.countUncategorized(false) - baseNoWs).isEqualTo(1);
    assertThat(messageRepo.countUncategorized(true) - baseWs).isEqualTo(2);
  }

  // ── 파일 ──────────────────────────────────────────────────────────────────────

  private void extraction(long uploader, String status, OffsetDateTime leasedUntil) {
    extraction(uploader, status, leasedUntil, 0, "FULL");
  }

  private void extraction(
      long uploader, String status, OffsetDateTime leasedUntil, int attempts, String profile) {
    String s = UUID.randomUUID().toString().replace("-", "").substring(0, 12);
    long fileId =
        dsl.insertInto(FILE)
            .set(FILE.ORIGINAL_NAME, "cap-" + s + ".txt")
            .set(FILE.STORED_NAME, "stored_" + s)
            .set(FILE.MIME_TYPE, "text/plain")
            .set(FILE.SIZE_BYTES, 10L)
            .set(FILE.STORAGE_PATH, "/data/uploads/" + s)
            .set(FILE.UPLOADED_BY, uploader)
            .returning(FILE.ID)
            .fetchOne()
            .getId();
    dsl.insertInto(FILE_EXTRACTION)
        .set(FILE_EXTRACTION.FILE_ID, fileId)
        .set(FILE_EXTRACTION.STATUS, status)
        .set(FILE_EXTRACTION.LEASED_UNTIL, leasedUntil)
        .set(FILE_EXTRACTION.ATTEMPTS, attempts)
        .set(FILE_EXTRACTION.PROFILE, profile)
        .set(FILE_EXTRACTION.TENANT_ID, 1L)
        .execute();
  }

  @Test
  void file_countsTextReadyAndExpiredSummarizing() {
    long uploader = human();
    int base = fileExtractionRepo.countSummaryPending();

    extraction(uploader, "TEXT_READY", null); // 셈
    extraction(uploader, "SUMMARIZING", OffsetDateTime.now().minusMinutes(5)); // 임대 만료 — 셈
    extraction(uploader, "SUMMARIZING", OffsetDateTime.now().plusMinutes(5)); // 임대 중 — 뺌
    extraction(uploader, "DONE", null); // 뺌
    extraction(uploader, "PENDING", null); // 뺌

    assertThat(fileExtractionRepo.countSummaryPending() - base).isEqualTo(2);
  }

  @Test
  void file_excludesExhaustedAttemptsAndNonFullProfile() {
    long uploader = human();
    int base = fileExtractionRepo.countSummaryPending();
    int max = com.workplace.fileai.repository.WorkerJobRepository.MAX_SUMMARY_ATTEMPTS;
    OffsetDateTime expired = OffsetDateTime.now().minusMinutes(5);

    extraction(uploader, "TEXT_READY", null, max - 1, "FULL"); // 상한 직전 — 셈
    extraction(uploader, "TEXT_READY", null, max, "FULL"); // 시도 상한 도달 — 뺌
    extraction(uploader, "SUMMARIZING", expired, max, "FULL"); // 만료됐어도 상한 도달 — 뺌
    extraction(uploader, "TEXT_READY", null, 0, "TEXT_ONLY"); // 요약 대상 아닌 프로파일 — 뺌
    extraction(uploader, "SUMMARIZING", expired, 0, "TEXT_ONLY"); // 뺌

    assertThat(fileExtractionRepo.countSummaryPending() - base).isEqualTo(1);
  }
}
