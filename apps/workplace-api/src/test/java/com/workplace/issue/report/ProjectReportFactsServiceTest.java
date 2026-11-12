package com.workplace.issue.report;

import static com.workplace.jooq.Tables.CYCLE;
import static com.workplace.jooq.Tables.ISSUE;
import static com.workplace.jooq.Tables.ISSUE_ASSIGNEE;
import static com.workplace.jooq.Tables.ISSUE_COMMENT;
import static com.workplace.jooq.Tables.ISSUE_CYCLE;
import static com.workplace.jooq.Tables.ISSUE_HISTORY;
import static com.workplace.jooq.Tables.ISSUE_TYPE_DEF;
import static com.workplace.jooq.Tables.USER;
import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.issue.dto.CreateIssueRequest;
import com.workplace.issue.overview.status.StatusBadge;
import com.workplace.issue.service.IssueService;
import com.workplace.project.dto.CreateProjectRequest;
import com.workplace.project.dto.ProjectResponse;
import com.workplace.project.dto.ProjectRow;
import com.workplace.project.repository.ProjectRepository;
import com.workplace.project.service.ProjectService;
import com.workplace.support.ExternalClientMockedTestBase;
import com.workplace.support.TestFixtures;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.transaction.annotation.Transactional;

/**
 * 리포트 계산값(WP-1483) — 표 행(완료는 DONE 만, 앞 회차 대비 변화, 열린·기한 지남은 지난 스냅숏 대비 또는 「—」, 진행 중 사이클 행), 변화 없음 판정,
 * 기간 이슈 목록(60건 상한·에픽별 남은 수·공개 주소)을 시드 이슈로 고정한다.
 *
 * <p>회차는 2026-11-09(월) ~ 15(일) 주간, 「지금」은 2026-11-16 09:00 KST. 앞 회차는 11-02 ~ 08.
 */
@Transactional
class ProjectReportFactsServiceTest extends ExternalClientMockedTestBase {

  private static final OffsetDateTime NOW = OffsetDateTime.parse("2026-11-16T09:00:00+09:00");
  private static final ReportPeriod PERIOD =
      new ReportPeriod(
          LocalDate.parse("2026-11-09"), LocalDate.parse("2026-11-15"), ReportCadence.WEEKLY);

  /** 두 회차 모두 밖의 생성 시각. */
  private static final OffsetDateTime OLD = OffsetDateTime.parse("2026-09-01T12:00:00+09:00");

  @Autowired DSLContext dsl;
  @Autowired ProjectService projectService;
  @Autowired ProjectRepository projectRepository;
  @Autowired IssueService issueService;
  @Autowired ProjectReportFactsService service;

  @Value("${workplace.public-base-url}")
  String baseUrl;

  private long owner;
  private ProjectResponse project;

  @BeforeEach
  void seed() {
    owner = TestFixtures.createHuman(dsl);
    dsl.update(USER).set(USER.NAME, "김담당").where(USER.ID.eq(owner)).execute();
    grantUserRole(owner);
    withMembership(owner);
    String suffix = UUID.randomUUID().toString().replaceAll("-", "").toUpperCase().substring(0, 4);
    project =
        projectService.create(
            owner, new CreateProjectRequest("RF" + suffix, "리포트-" + suffix, "x", "TEAM"));
  }

  // ───────────── 시드 헬퍼 ─────────────

  private static OffsetDateTime kst(String localDateTime) {
    return OffsetDateTime.parse(localDateTime + "+09:00");
  }

  /** 담당자 없는 이슈 — 범주·생성 시각을 정하고, 종료 범주면 닫힌 시각을 따로 받는다. */
  private long issue(
      String title, String status, OffsetDateTime createdAt, OffsetDateTime closedAt) {
    var created =
        issueService.create(
            owner,
            project.key(),
            new CreateIssueRequest(title, null, null, null, null, null, null, null));
    dsl.deleteFrom(ISSUE_ASSIGNEE).where(ISSUE_ASSIGNEE.ISSUE_ID.eq(created.id())).execute();
    dsl.deleteFrom(ISSUE_HISTORY).where(ISSUE_HISTORY.ISSUE_ID.eq(created.id())).execute();
    dsl.update(ISSUE)
        .set(ISSUE.STATUS, status)
        .set(ISSUE.STATUS_ID, TestFixtures.defaultStatusId(ISSUE.PROJECT_ID, status))
        .set(ISSUE.CREATED_AT, createdAt)
        .set(ISSUE.UPDATED_AT, createdAt)
        .set(ISSUE.CLOSED_AT, closedAt)
        .where(ISSUE.ID.eq(created.id()))
        .execute();
    return created.id();
  }

  private long open(OffsetDateTime createdAt) {
    return issue("열림-" + UUID.randomUUID().toString().substring(0, 6), "TODO", createdAt, null);
  }

  private long closed(String status, OffsetDateTime closedAt) {
    return issue("닫힘-" + UUID.randomUUID().toString().substring(0, 6), status, OLD, closedAt);
  }

  private void due(long issueId, LocalDate due) {
    dsl.update(ISSUE).set(ISSUE.DUE_DATE, due).where(ISSUE.ID.eq(issueId)).execute();
  }

  private void typeAs(long issueId, String typeName) {
    Long typeId =
        dsl.select(ISSUE_TYPE_DEF.ID)
            .from(ISSUE_TYPE_DEF)
            .where(ISSUE_TYPE_DEF.PROJECT_ID.eq(project.id()))
            .and(ISSUE_TYPE_DEF.NAME.eq(typeName))
            .fetchOne(ISSUE_TYPE_DEF.ID);
    dsl.update(ISSUE).set(ISSUE.TYPE_ID, typeId).where(ISSUE.ID.eq(issueId)).execute();
  }

  private void parent(long childId, long parentId) {
    dsl.update(ISSUE).set(ISSUE.PARENT_ISSUE_ID, parentId).where(ISSUE.ID.eq(childId)).execute();
  }

  private ProjectRow row() {
    return projectRepository.findById(project.id()).orElseThrow();
  }

  private ProjectReportFacts compute(Optional<ReportSnapshot> last) {
    return service.compute(row(), PERIOD, last, NOW);
  }

  private static ReportTableRow find(ProjectReportFacts f, String label) {
    return f.rows().stream().filter(r -> r.label().equals(label)).findFirst().orElseThrow();
  }

  // ───────────── 표 행 ─────────────

  @Test
  void rows_countCompletedDoneOnly() {
    closed("DONE", kst("2026-11-10T10:00:00"));
    closed("DONE", kst("2026-11-15T23:30:00"));
    closed("CANCELED", kst("2026-11-11T10:00:00"));
    // 회차 끝 다음 날 자정 이후 — 이번 회차가 아니다.
    closed("DONE", kst("2026-11-16T00:10:00"));

    ProjectReportFacts f = compute(Optional.empty());

    assertThat(f.rows())
        .extracting(ReportTableRow::label)
        .containsExactly("완료", "새로 생김", "열린 이슈", "기한 지남");
    assertThat(find(f, "완료").current()).isEqualTo("2");
    assertThat(f.snapshot().completed()).isEqualTo(2);
  }

  @Test
  void rows_changeVsPreviousPeriod() {
    closed("DONE", kst("2026-11-10T10:00:00"));
    closed("DONE", kst("2026-11-12T10:00:00"));
    closed("DONE", kst("2026-11-05T10:00:00"));
    open(kst("2026-11-10T10:00:00"));
    open(kst("2026-11-03T10:00:00"));
    open(kst("2026-11-04T10:00:00"));

    ProjectReportFacts f = compute(Optional.empty());

    assertThat(find(f, "완료").change()).isEqualTo("+1");
    assertThat(find(f, "새로 생김").current()).isEqualTo("1");
    assertThat(find(f, "새로 생김").change()).isEqualTo("−1");
  }

  @Test
  void rows_monthlyPreviousIsCalendarMonth() {
    ReportPeriod nov =
        new ReportPeriod(
            LocalDate.parse("2026-11-01"), LocalDate.parse("2026-11-30"), ReportCadence.MONTHLY);
    closed("DONE", kst("2026-11-20T10:00:00"));
    // 10월 1일 — 같은 길이(30일) 앞 기간(10/2~10/31)에는 없지만 지난 달력 달에는 든다.
    closed("DONE", kst("2026-10-01T10:00:00"));
    closed("DONE", kst("2026-10-15T10:00:00"));

    ProjectReportFacts f =
        service.compute(row(), nov, Optional.empty(), kst("2026-12-07T09:00:00"));

    assertThat(find(f, "완료").current()).isEqualTo("1");
    assertThat(find(f, "완료").change()).isEqualTo("−1");
  }

  @Test
  void rows_openAndOverdueChange_dashWithoutSnapshot() {
    open(OLD);

    ProjectReportFacts f = compute(Optional.empty());

    assertThat(find(f, "열린 이슈").current()).isEqualTo("1");
    assertThat(find(f, "열린 이슈").change()).isEqualTo("—");
    assertThat(find(f, "기한 지남").change()).isEqualTo("—");
    assertThat(find(f, "완료").change()).isEqualTo("0");
    assertThat(f.previousBadge()).isNull();
  }

  @Test
  void rows_openChange_vsLastSnapshot() {
    open(OLD);
    open(OLD);
    long late = open(OLD);
    due(late, LocalDate.parse("2026-11-10"));

    ProjectReportFacts f =
        compute(Optional.of(new ReportSnapshot(4, 1, 5, 0, StatusBadge.WARN.name())));

    assertThat(find(f, "열린 이슈").current()).isEqualTo("3");
    assertThat(find(f, "열린 이슈").change()).isEqualTo("−2");
    assertThat(find(f, "기한 지남").current()).isEqualTo("1");
    assertThat(find(f, "기한 지남").change()).isEqualTo("+1");
    assertThat(f.badge()).isEqualTo(StatusBadge.ON_TRACK);
    assertThat(f.previousBadge()).isEqualTo(StatusBadge.WARN);
    assertThat(f.snapshot()).isEqualTo(new ReportSnapshot(0, 0, 3, 1, StatusBadge.ON_TRACK.name()));
  }

  @Test
  void rows_cycleRow_whenActiveCycle() {
    long cycle =
        dsl.insertInto(CYCLE)
            .set(CYCLE.PROJECT_ID, project.id())
            .set(CYCLE.NAME, "C-1")
            .set(CYCLE.STATUS, "ACTIVE")
            .set(CYCLE.START_DATE, LocalDate.parse("2026-11-10"))
            .set(CYCLE.END_DATE, LocalDate.parse("2026-11-23"))
            .returning(CYCLE.ID)
            .fetchOne()
            .getId();
    long a = closed("DONE", kst("2026-11-12T10:00:00"));
    long b = open(OLD);
    for (long id : List.of(a, b)) {
      dsl.insertInto(ISSUE_CYCLE)
          .set(ISSUE_CYCLE.ISSUE_ID, id)
          .set(ISSUE_CYCLE.CYCLE_ID, cycle)
          .set(ISSUE_CYCLE.CREATED_AT, kst("2026-11-10T09:00:00"))
          .execute();
    }

    ProjectReportFacts f = compute(Optional.empty());

    assertThat(f.rows()).hasSize(5);
    ReportTableRow c = f.rows().get(4);
    assertThat(c.label()).startsWith("사이클 ").isEqualTo("사이클 11/10~23");
    assertThat(c.current()).isEqualTo("1 / 2");
    assertThat(c.change()).matches("예상 \\d{1,2}/\\d{1,2}|—");
  }

  @Test
  void noChange_whenNothingCompletedOrCreated() {
    open(OLD);
    closed("CANCELED", kst("2026-11-10T10:00:00"));

    assertThat(compute(Optional.empty()).noChange()).isTrue();

    open(kst("2026-11-12T10:00:00"));

    assertThat(compute(Optional.empty()).noChange()).isFalse();
  }

  // ───────────── 이슈 목록 ─────────────

  @Test
  void issues_capAt60_withOmittedByEpic() {
    long epic = issue("노트 에픽", "IN_PROGRESS", OLD, null);
    typeAs(epic, "EPIC");
    long overdue = open(OLD);
    due(overdue, LocalDate.parse("2026-11-01"));
    // 가장 오래된 생성 셋 — 상한 밖으로 밀린다(둘은 에픽 아래).
    long e1 = open(kst("2026-11-09T01:00:00"));
    long e2 = open(kst("2026-11-09T02:00:00"));
    open(kst("2026-11-09T03:00:00"));
    parent(e1, epic);
    parent(e2, epic);
    // 그보다 늦게 생긴 59건.
    for (int i = 0; i < 59; i++) {
      open(kst("2026-11-10T00:00:00").plusMinutes(i * 10L));
    }

    ProjectReportFacts f = compute(Optional.empty());

    assertThat(f.issues()).hasSize(60);
    assertThat(f.issues().get(0).reason()).isEqualTo("OVERDUE");
    assertThat(f.issues().get(1).reason()).isEqualTo("CREATED");
    // 생김은 최신순.
    assertThat(f.issues().get(1).key())
        .endsWith(
            "-"
                + (dsl.select(ISSUE.NUMBER)
                    .from(ISSUE)
                    .where(ISSUE.PROJECT_ID.eq(project.id()))
                    .orderBy(ISSUE.NUMBER.desc())
                    .limit(1)
                    .fetchOne(ISSUE.NUMBER)));
    assertThat(f.omittedByEpic())
        .containsEntry("노트 에픽", 2)
        .containsEntry(ProjectReportIssueRepository.NO_EPIC, 1)
        .hasSize(2);
  }

  @Test
  void issues_urlUsesPublicBaseUrl() {
    String longTitle = "가".repeat(100);
    long done = issue(longTitle, "DONE", kst("2026-11-10T09:00:00"), kst("2026-11-11T09:00:00"));
    dsl.insertInto(ISSUE_ASSIGNEE)
        .set(ISSUE_ASSIGNEE.ISSUE_ID, done)
        .set(ISSUE_ASSIGNEE.USER_ID, owner)
        .set(ISSUE_ASSIGNEE.ASSIGNED_BY, owner)
        .execute();
    dsl.insertInto(ISSUE_COMMENT)
        .set(ISSUE_COMMENT.ISSUE_ID, done)
        .set(ISSUE_COMMENT.AUTHOR_ID, owner)
        .set(ISSUE_COMMENT.BODY, "예전 댓글")
        .set(ISSUE_COMMENT.CREATED_AT, kst("2026-11-10T10:00:00"))
        .execute();
    dsl.insertInto(ISSUE_COMMENT)
        .set(ISSUE_COMMENT.ISSUE_ID, done)
        .set(ISSUE_COMMENT.AUTHOR_ID, owner)
        .set(ISSUE_COMMENT.BODY, "나".repeat(150))
        .set(ISSUE_COMMENT.CREATED_AT, kst("2026-11-11T10:00:00"))
        .execute();
    int number =
        dsl.select(ISSUE.NUMBER).from(ISSUE).where(ISSUE.ID.eq(done)).fetchOne(ISSUE.NUMBER);

    ProjectReportFacts f = compute(Optional.empty());

    assertThat(f.issues()).hasSize(1);
    ReportIssue i = f.issues().get(0);
    String base = baseUrl.endsWith("/") ? baseUrl.substring(0, baseUrl.length() - 1) : baseUrl;
    assertThat(i.url()).isEqualTo(base + "/projects/" + project.key() + "/issues/" + number);
    assertThat(i.key()).isEqualTo(project.key() + "-" + number);
    // 생기고 닫힌 이슈는 닫힘 한 번으로만.
    assertThat(i.reason()).isEqualTo("DONE");
    assertThat(i.category()).isEqualTo("DONE");
    assertThat(i.statusName()).isNotBlank();
    assertThat(i.title()).hasSize(80);
    assertThat(i.assignees()).containsExactly("김담당");
    assertThat(i.lastComment()).hasSize(120).startsWith("나");
    assertThat(i.epic()).isNull();
  }
}
