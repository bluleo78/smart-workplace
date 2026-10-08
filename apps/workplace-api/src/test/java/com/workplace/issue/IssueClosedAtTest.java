package com.workplace.issue;

import static com.workplace.jooq.Tables.ISSUE;
import static com.workplace.jooq.Tables.MILESTONE;
import static com.workplace.jooq.Tables.USER;
import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.global.tenant.TenantContext;
import com.workplace.issue.dto.CreateCommentRequest;
import com.workplace.issue.dto.IssueResponse;
import com.workplace.issue.repository.IssueRepository;
import com.workplace.issue.service.IssueCommentService;
import com.workplace.issue.service.IssueSearchService;
import com.workplace.issue.service.IssueService;
import com.workplace.project.dto.CreateProjectRequest;
import com.workplace.project.service.ProjectService;
import com.workplace.support.IntegrationTestBase;
import java.time.OffsetDateTime;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.annotation.Transactional;

/**
 * WP-307: 이슈 종료 시각(closedAt) 노출과 종료일·생성일 범위 필터.
 *
 * <p>AI(MCP·AI Chat)가 "언제 완료됐어?", "이번 주 완료한 이슈" 에 답하려면 응답에 closedAt 이 있어야 하고, 날짜 범위는 비서가 쓰는
 * Asia/Seoul 하루 경계로 잘려야 한다(UTC 로 자르면 KST 00~09시 종료분이 전날로 넘어간다).
 */
@Transactional
class IssueClosedAtTest extends IntegrationTestBase {

  @Autowired private IssueService issueService;
  @Autowired private IssueCommentService commentService;
  @Autowired private IssueSearchService searchService;
  @Autowired private IssueRepository issueRepository;
  @Autowired private ProjectService projectService;

  private long userId;
  private String projKey;
  private long projectId;

  @BeforeEach
  void setUp() {
    String suffix = UUID.randomUUID().toString().replaceAll("-", "").substring(0, 8);
    userId =
        baseDsl
            .insertInto(USER)
            .set(USER.USERNAME, "cl-" + suffix)
            .set(USER.PASSWORD, "pw")
            .set(USER.NAME, "cl")
            .set(USER.EMAIL, "cl-" + suffix + "@example.com")
            .returning(USER.ID)
            .fetchOne()
            .getId();
    TenantContext.set(1L);
    projKey = "CL" + suffix.substring(0, 4).toUpperCase();
    projectId =
        projectService.create(userId, new CreateProjectRequest(projKey, "Closed", "x")).id();
  }

  /** 종료 상태로 바꾸면 closedAt 이 채워지고, 재오픈하면 null 로 돌아간다 — 상세·목록 응답 모두. */
  @Test
  void closedAt_setOnDone_clearedOnReopen() {
    issueRepository.insert(projectId, 1, "완료될 이슈", null, "MID", null, userId);

    var done = issueService.updateStatus(userId, projKey, 1, "DONE");
    assertThat(done.summary().closedAt()).isNotNull();
    var listed = searchService.search(userId, projKey, Map.of());
    assertThat(listed.items()).extracting(IssueResponse::closedAt).doesNotContainNull();

    var reopened = issueService.updateStatus(userId, projKey, 1, "TODO");
    assertThat(reopened.summary().closedAt()).isNull();
  }

  /** 취소도 종료 상태라 closedAt 이 채워진다 — 완료/취소 구분은 status 로 한다. */
  @Test
  void closedAt_setOnCanceled() {
    issueRepository.insert(projectId, 1, "취소될 이슈", null, "MID", null, userId);

    var canceled = issueService.updateStatus(userId, projKey, 1, "CANCELED");

    assertThat(canceled.summary().status()).isEqualTo("CANCELED");
    assertThat(canceled.summary().closedAt()).isNotNull();
  }

  /** closedFrom/closedTo 는 Asia/Seoul 날짜 경계로 양끝 포함 — KST 이른 아침 종료분이 그 날짜에 잡힌다. */
  @Test
  void closedRange_usesSeoulDayBoundary() {
    // KST 10-08 00:30 (= UTC 10-07 15:30) 종료 — UTC 로 자르면 10-07 로 잘못 분류된다.
    long early = insertClosed(1, "2026-10-08T00:30:00+09:00");
    // KST 10-07 23:59 종료 — 10-07 에 속한다.
    long prevDay = insertClosed(2, "2026-10-07T23:59:00+09:00");
    // 미종료 — 종료일 필터에서 항상 빠진다.
    issueRepository.insert(projectId, 3, "열린 이슈", null, "MID", null, userId);

    var oct8 =
        searchService.search(
            userId, projKey, Map.of("closedFrom", "2026-10-08", "closedTo", "2026-10-08"));
    assertThat(oct8.items()).extracting(IssueResponse::id).containsExactly(early);

    var oct7 = searchService.search(userId, projKey, Map.of("closedTo", "2026-10-07"));
    assertThat(oct7.items()).extracting(IssueResponse::id).containsExactly(prevDay);
  }

  /** createdFrom/createdTo 도 같은 규칙 — 횡단(/me/issues) 경로에서도 적용된다. */
  @Test
  void createdRange_appliesOnCrossProjectSearch() {
    long oldIssue = issueRepository.insert(projectId, 1, "옛 이슈", null, "MID", null, userId).id();
    long newIssue = issueRepository.insert(projectId, 2, "새 이슈", null, "MID", null, userId).id();
    setCreatedAt(oldIssue, "2026-09-01T10:00:00+09:00");
    setCreatedAt(newIssue, "2026-10-08T01:00:00+09:00");

    var res =
        searchService.searchMine(userId, Map.of("reporter", "me", "createdFrom", "2026-10-08"));

    assertThat(res.items()).extracting(IssueResponse::id).containsExactly(newIssue);
  }

  /** 코멘트·이력 응답이 작성자 username 을 싣는다 — AI 도구가 표시 이름 대신 쓰는 식별자(WP-307). */
  @Test
  void commentAndHistory_carryAuthorUsername() {
    long issueId = issueRepository.insert(projectId, 1, "작성자 확인", null, "MID", null, userId).id();
    String username =
        baseDsl.select(USER.USERNAME).from(USER).where(USER.ID.eq(userId)).fetchOne(USER.USERNAME);

    var comment = commentService.create(userId, issueId, new CreateCommentRequest("확인"));
    var detail = issueService.updateStatus(userId, projKey, 1, "IN_PROGRESS");

    assertThat(comment.authorUsername()).isEqualTo(username);
    assertThat(detail.comments()).extracting(c -> c.authorUsername()).containsExactly(username);
    assertThat(detail.history()).extracting(h -> h.actorUsername()).containsOnly(username);
  }

  /** 마일스톤이 연결되면 응답에 이름이 함께 실린다(목록·상세) — AI 도구가 목록을 따로 조회하지 않는다(WP-307). */
  @Test
  void milestoneName_includedInListAndDetail() {
    long issueId = issueRepository.insert(projectId, 1, "마일스톤 이슈", null, "MID", null, userId).id();
    issueRepository.insert(projectId, 2, "마일스톤 없음", null, "MID", null, userId);
    Long milestoneId =
        baseDsl
            .insertInto(MILESTONE)
            .set(MILESTONE.PROJECT_ID, projectId)
            .set(MILESTONE.NAME, "v1.0")
            .set(MILESTONE.DUE_DATE, java.time.LocalDate.parse("2026-12-31"))
            .returning(MILESTONE.ID)
            .fetchOne()
            .getId();
    baseDsl
        .update(ISSUE)
        .set(ISSUE.MILESTONE_ID, milestoneId)
        .where(ISSUE.ID.eq(issueId))
        .execute();

    assertThat(issueService.get(userId, projKey, 1).summary().milestoneName()).isEqualTo("v1.0");
    assertThat(searchService.search(userId, projKey, Map.of()).items())
        .extracting(IssueResponse::number, IssueResponse::milestoneName)
        .containsExactlyInAnyOrder(
            org.assertj.core.groups.Tuple.tuple(1, "v1.0"),
            org.assertj.core.groups.Tuple.tuple(2, null));
  }

  // ── 헬퍼 ────────────────────────────────────────────────────────────────────────

  /** DONE 상태 + 지정 종료 시각 이슈 삽입(시각 고정을 위해 서비스 전이 대신 직접 갱신). */
  private long insertClosed(int number, String closedAt) {
    long id =
        issueRepository.insert(projectId, number, "종료 " + number, null, "MID", null, userId).id();
    baseDsl
        .update(ISSUE)
        .set(ISSUE.STATUS, "DONE")
        .set(ISSUE.CLOSED_AT, OffsetDateTime.parse(closedAt))
        .where(ISSUE.ID.eq(id))
        .execute();
    return id;
  }

  private void setCreatedAt(long id, String createdAt) {
    baseDsl
        .update(ISSUE)
        .set(ISSUE.CREATED_AT, OffsetDateTime.parse(createdAt))
        .where(ISSUE.ID.eq(id))
        .execute();
  }
}
