package com.workplace.issue.report;

import static com.workplace.jooq.Tables.CYCLE;
import static com.workplace.jooq.Tables.ISSUE;
import static com.workplace.jooq.Tables.ISSUE_ASSIGNEE;
import static com.workplace.jooq.Tables.ISSUE_COMMENT;
import static com.workplace.jooq.Tables.ISSUE_CYCLE;
import static com.workplace.jooq.Tables.ISSUE_HISTORY;
import static com.workplace.jooq.Tables.ISSUE_TYPE_DEF;
import static com.workplace.jooq.Tables.ISSUE_VERSION;
import static com.workplace.jooq.Tables.PROJECT_VERSION;
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
    long cycle = cycle("C-1", "ACTIVE", "2026-11-10", "2026-11-23");
    link(closed("DONE", kst("2026-11-12T10:00:00")), cycle, kst("2026-11-10T09:00:00"));
    link(open(OLD), cycle, kst("2026-11-10T09:00:00"));

    ProjectReportFacts f = compute(Optional.empty());

    assertThat(f.rows()).hasSize(5);
    ReportTableRow c = f.rows().get(4);
    assertThat(c.label()).startsWith("사이클 ").isEqualTo("사이클 11/10~23");
    assertThat(c.current()).isEqualTo("1 / 2");
    assertThat(c.change()).matches("예상 \\d{1,2}/\\d{1,2}|—");
  }

  // ───────────── 기간 끝 기준 배지·사이클 행(WP-1631) ─────────────

  /** 리포트를 만드는 실제 시각 — 회차 다음 월요일 00:03(KST). 그날 시작한 새 사이클이 「지금」 진행 중이다. */
  private static final OffsetDateTime GENERATED_AT = kst("2026-11-16T00:03:00");

  /** 사이클 하나를 만든다(시작·종료일은 null 허용). 만든 시각은 DB 기본값(지금). */
  private long cycle(String name, String status, String start, String end) {
    return cycle(name, status, start, end, null);
  }

  /** 사이클 하나를 만든 시각을 정해 만든다 — 시작일 없는 사이클은 만든 날(서울)이 시작이라 그 경계를 시험할 때 쓴다. null 이면 DB 기본값. */
  private long cycle(
      String name, String status, String start, String end, OffsetDateTime createdAt) {
    var insert =
        dsl.insertInto(CYCLE)
            .set(CYCLE.PROJECT_ID, project.id())
            .set(CYCLE.NAME, name)
            .set(CYCLE.STATUS, status)
            .set(CYCLE.START_DATE, start == null ? null : LocalDate.parse(start))
            .set(CYCLE.END_DATE, end == null ? null : LocalDate.parse(end));
    if (createdAt != null) {
      insert = insert.set(CYCLE.CREATED_AT, createdAt);
    }
    return insert.returning(CYCLE.ID).fetchOne().getId();
  }

  /** 이슈를 사이클에 연결한다 — 연결 시각이 범위에 들어온 시각이다. */
  private void link(long issueId, long cycleId, OffsetDateTime at) {
    dsl.insertInto(ISSUE_CYCLE)
        .set(ISSUE_CYCLE.ISSUE_ID, issueId)
        .set(ISSUE_CYCLE.CYCLE_ID, cycleId)
        .set(ISSUE_CYCLE.CREATED_AT, at)
        .execute();
  }

  /** 월요일에 막 시작한 새 사이클 B(0/4) — 생성 시각 기준 「진행 중」 위젯은 이걸 고른다. */
  private void seedJustStartedCycle() {
    long b = cycle("B", "ACTIVE", "2026-11-16", "2026-11-29");
    for (int i = 0; i < 4; i++) {
      link(open(kst("2026-11-16T00:01:00")), b, kst("2026-11-16T00:01:00"));
    }
  }

  @Test
  void asOfPeriodEnd_usesCycleInProgressThen_notJustStartedOne() {
    // 일요일에 끝난 사이클 A — 4건 모두 기간 안에 끝냈다(배치 끝에 COMPLETED).
    long a = cycle("A", "COMPLETED", "2026-11-09", "2026-11-15");
    for (int d = 10; d <= 13; d++) {
      link(closed("DONE", kst("2026-11-" + d + "T10:00:00")), a, kst("2026-11-09T09:00:00"));
    }
    seedJustStartedCycle();

    ProjectReportFacts f = service.compute(row(), PERIOD, Optional.empty(), GENERATED_AT);

    // 생성 시각(B: 0/4, 예상 없음) 기준이면 주의 — 기간 끝 기준이면 A 가 다 끝나 순조로움.
    ReportTableRow c = f.rows().get(4);
    assertThat(c.label()).isEqualTo("사이클 11/9~15");
    assertThat(c.current()).isEqualTo("4 / 4");
    assertThat(c.change()).isEqualTo("예상 11/15");
    assertThat(f.badge()).isEqualTo(StatusBadge.ON_TRACK);
  }

  @Test
  void asOfPeriodEnd_closedOrAddedAfterEnd_notCounted() {
    long a = cycle("A", "COMPLETED", "2026-11-09", "2026-11-15");
    for (int d = 10; d <= 12; d++) {
      link(closed("DONE", kst("2026-11-" + d + "T10:00:00")), a, kst("2026-11-09T09:00:00"));
    }
    // 기간 끝 다음 날 새벽에 닫힌 이슈 — 기간 끝 시점엔 아직 남은 일이다.
    link(closed("DONE", kst("2026-11-16T00:01:00")), a, kst("2026-11-09T09:00:00"));
    // 기간 끝 뒤에 사이클에 들어온 이슈 — 기간 끝 시점 범위가 아니다.
    link(open(OLD), a, kst("2026-11-16T00:02:00"));
    seedJustStartedCycle();

    ProjectReportFacts f = service.compute(row(), PERIOD, Optional.empty(), GENERATED_AT);

    ReportTableRow c = f.rows().get(4);
    assertThat(c.label()).isEqualTo("사이클 11/9~15");
    assertThat(c.current()).isEqualTo("3 / 4");
    // 남은 1 ÷ (최근 7일 완료 3건) → 11/15 + ceil(7/3)=3일 → 11/18, 종료일보다 3일 늦어 주의(규칙: 3일 초과부터 위험).
    assertThat(c.change()).isEqualTo("예상 11/18");
    assertThat(f.badge()).isEqualTo(StatusBadge.WARN);
  }

  @Test
  void asOfPeriodEnd_noCycleThen_onTrackWithoutCycleRow() {
    // 기간을 덮지만 시작하지 않은(PLANNED) 사이클은 그때 진행 중이 아니었다.
    long planned = cycle("P", "PLANNED", "2026-11-09", "2026-11-22");
    link(open(OLD), planned, kst("2026-11-09T09:00:00"));
    seedJustStartedCycle();

    ProjectReportFacts f = service.compute(row(), PERIOD, Optional.empty(), GENERATED_AT);

    assertThat(f.rows())
        .extracting(ReportTableRow::label)
        .containsExactly("완료", "새로 생김", "열린 이슈", "기한 지남");
    assertThat(f.badge()).isEqualTo(StatusBadge.ON_TRACK);
  }

  @Test
  void asOfPeriodEnd_activeCyclePastEnd_stillInProgressThen() {
    // 종료일(11/8)을 넘겨 아직 ACTIVE 인 사이클 — 기간 끝에도 진행 중이었다. 남은 일·최근 완료 없음 → 위험.
    long late = cycle("L", "ACTIVE", "2026-11-01", "2026-11-08");
    link(open(OLD), late, kst("2026-11-01T09:00:00"));

    ProjectReportFacts f = service.compute(row(), PERIOD, Optional.empty(), GENERATED_AT);

    ReportTableRow c = f.rows().get(4);
    assertThat(c.label()).isEqualTo("사이클 11/1~8");
    assertThat(c.current()).isEqualTo("0 / 1");
    assertThat(f.badge()).isEqualTo(StatusBadge.RISK);
  }

  @Test
  void asOfPeriodEnd_cycleWithoutStartDate_usesCreatedDate() {
    // 시작일 없는 사이클은 만든 날(서울)을 시작으로 본다 — 기간 끝 뒤(월 00:00:30 KST)에 만들었으면 그때 진행 중이 아니었다.
    long noStart = cycle("N", "ACTIVE", null, "2026-11-19", kst("2026-11-16T00:00:30"));
    link(open(OLD), noStart, kst("2026-11-16T00:01:00"));
    // 기간 중에 만든 시작일 없는 사이클은 후보다 — 라벨은 만든 날부터.
    long earlier = cycle("E", "COMPLETED", null, "2026-11-20", kst("2026-11-11T09:00:00"));
    link(closed("DONE", kst("2026-11-12T10:00:00")), earlier, kst("2026-11-11T09:00:00"));

    ProjectReportFacts f = service.compute(row(), PERIOD, Optional.empty(), GENERATED_AT);

    ReportTableRow c = f.rows().get(4);
    assertThat(c.label()).isEqualTo("사이클 11/11~20");
    assertThat(c.current()).isEqualTo("1 / 1");
    assertThat(f.badge()).isEqualTo(StatusBadge.ON_TRACK);
  }

  @Test
  void asOfPeriodEnd_oldCompletedCycleWithoutDates_notInProgressThen() {
    // 오래전에 끝낸(COMPLETED) 날짜 없는 사이클 — 종료일이 없다고 이후 모든 날에 진행 중으로 보면 안 된다.
    long old = cycle("O", "COMPLETED", null, null, OLD);
    link(open(OLD), old, OLD);

    ProjectReportFacts f = service.compute(row(), PERIOD, Optional.empty(), GENERATED_AT);

    assertThat(f.rows())
        .extracting(ReportTableRow::label)
        .containsExactly("완료", "새로 생김", "열린 이슈", "기한 지남");
    assertThat(f.badge()).isEqualTo(StatusBadge.ON_TRACK);
  }

  @Test
  void asOfPeriodEnd_earlyCompletedCycle_losesToCycleThatTookOver() {
    // A 는 종료일(11/20) 전에 일찍 끝냈고(COMPLETED), B 가 11/13 에 이어받아 진행 중이다 — 그날 진행 중이던 건 B 다.
    long a = cycle("A", "COMPLETED", "2026-11-09", "2026-11-20");
    link(closed("DONE", kst("2026-11-10T10:00:00")), a, kst("2026-11-09T09:00:00"));
    long b = cycle("B", "ACTIVE", "2026-11-13", "2026-11-26");
    link(open(OLD), b, kst("2026-11-13T09:00:00"));
    link(open(OLD), b, kst("2026-11-13T09:00:00"));

    ProjectReportFacts f = service.compute(row(), PERIOD, Optional.empty(), GENERATED_AT);

    ReportTableRow c = f.rows().get(4);
    assertThat(c.label()).isEqualTo("사이클 11/13~26");
    assertThat(c.current()).isEqualTo("0 / 2");
    // 최근 완료 없음 → 예상 없음, 종료일 전이라 주의.
    assertThat(c.change()).isEqualTo("—");
    assertThat(f.badge()).isEqualTo(StatusBadge.WARN);
  }

  @Test
  void asOfPeriodEnd_versionReleasedAfterEnd_stillShown() {
    // 사이클 없음. 출시일 11/15 버전을 기간 끝 다음 날 00:01 에 출시 처리했다 — 기간 끝 시점엔 아직 미출시였다.
    long v =
        dsl.insertInto(PROJECT_VERSION)
            .set(PROJECT_VERSION.PROJECT_ID, project.id())
            .set(PROJECT_VERSION.NAME, "v1.0")
            .set(PROJECT_VERSION.RELEASE_DATE, LocalDate.parse("2026-11-15"))
            .set(PROJECT_VERSION.RELEASED_AT, kst("2026-11-16T00:01:00"))
            .returning(PROJECT_VERSION.ID)
            .fetchOne()
            .getId();
    long done = closed("DONE", kst("2026-11-14T10:00:00"));
    dsl.insertInto(ISSUE_VERSION)
        .set(ISSUE_VERSION.ISSUE_ID, done)
        .set(ISSUE_VERSION.VERSION_ID, v)
        .set(ISSUE_VERSION.KIND, "FIX")
        .execute();

    ProjectReportFacts f = service.compute(row(), PERIOD, Optional.empty(), GENERATED_AT);

    ReportTableRow c = f.rows().get(4);
    assertThat(c.label()).isEqualTo("v1.0 (11/15)");
    assertThat(c.current()).isEqualTo("1 / 1");
    assertThat(f.badge()).isEqualTo(StatusBadge.ON_TRACK);
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
    // 담당 사람/AI 구분은 개인 보고 전용(WP-1632) — 프로젝트 요청에는 이름을 두 번 싣지 않게 비운다.
    assertThat(i.assigneesDetail()).isNull();
    assertThat(i.lastComment()).hasSize(120).startsWith("나");
    assertThat(i.epic()).isNull();
  }
}
