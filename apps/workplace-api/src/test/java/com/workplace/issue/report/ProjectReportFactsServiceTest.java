package com.workplace.issue.report;

import static com.workplace.jooq.Tables.CYCLE;
import static com.workplace.jooq.Tables.ISSUE;
import static com.workplace.jooq.Tables.ISSUE_ASSIGNEE;
import static com.workplace.jooq.Tables.ISSUE_COMMENT;
import static com.workplace.jooq.Tables.ISSUE_CYCLE;
import static com.workplace.jooq.Tables.ISSUE_HISTORY;
import static com.workplace.jooq.Tables.ISSUE_LABEL;
import static com.workplace.jooq.Tables.ISSUE_TYPE_DEF;
import static com.workplace.jooq.Tables.ISSUE_VERSION;
import static com.workplace.jooq.Tables.LABEL;
import static com.workplace.jooq.Tables.PROJECT_VERSION;
import static com.workplace.jooq.Tables.USER;
import static com.workplace.support.TestFixtures.uniqueProjectKey;
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
 * 에픽 집계(WP-1629 — 완료·진행 중·상시·결정 후보·지표, 제목 상한)를 시드 이슈로 고정한다.
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
    String key = uniqueProjectKey("RF");
    project =
        projectService.create(owner, new CreateProjectRequest(key, "리포트-" + key, "x", "TEAM"));
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

  // ───────────── 에픽 집계(WP-1629) ─────────────

  /** 에픽 유형 이슈 — 상태·생성·닫힘·기한을 정한다. */
  private long epic(String title, String status, OffsetDateTime closedAt, LocalDate dueDate) {
    long id = issue(title, status, OLD, closedAt);
    typeAs(id, "EPIC");
    if (dueDate != null) due(id, dueDate);
    return id;
  }

  /** 에픽(또는 다른 부모) 아래 DONE 하위. */
  private long doneChild(String title, long parentId, OffsetDateTime closedAt) {
    long id = issue(title, "DONE", OLD, closedAt);
    parent(id, parentId);
    return id;
  }

  /** 프로젝트 라벨을 (없으면 만들어) 이슈에 붙인다. */
  private void label(long issueId, String name) {
    Long labelId =
        dsl.select(LABEL.ID)
            .from(LABEL)
            .where(LABEL.PROJECT_ID.eq(project.id()))
            .and(LABEL.NAME.eq(name))
            .fetchOne(LABEL.ID);
    if (labelId == null) {
      labelId =
          dsl.insertInto(LABEL)
              .set(LABEL.PROJECT_ID, project.id())
              .set(LABEL.NAME, name)
              .set(LABEL.COLOR_TOKEN, "blue")
              .returning(LABEL.ID)
              .fetchOne()
              .getId();
    }
    dsl.insertInto(ISSUE_LABEL)
        .set(ISSUE_LABEL.ISSUE_ID, issueId)
        .set(ISSUE_LABEL.LABEL_ID, labelId)
        .execute();
  }

  private void assign(long issueId, long userId) {
    dsl.insertInto(ISSUE_ASSIGNEE)
        .set(ISSUE_ASSIGNEE.ISSUE_ID, issueId)
        .set(ISSUE_ASSIGNEE.USER_ID, userId)
        .set(ISSUE_ASSIGNEE.ASSIGNED_BY, owner)
        .execute();
  }

  private void comment(long issueId, String body, OffsetDateTime at) {
    dsl.insertInto(ISSUE_COMMENT)
        .set(ISSUE_COMMENT.ISSUE_ID, issueId)
        .set(ISSUE_COMMENT.AUTHOR_ID, owner)
        .set(ISSUE_COMMENT.BODY, body)
        .set(ISSUE_COMMENT.CREATED_AT, at)
        .execute();
  }

  private String keyOf(long issueId) {
    int number =
        dsl.select(ISSUE.NUMBER).from(ISSUE).where(ISSUE.ID.eq(issueId)).fetchOne(ISSUE.NUMBER);
    return project.key() + "-" + number;
  }

  /**
   * 완료(이번·지난)·상시·진행 중·에픽 없는 완료·결정 후보·지표를 한 시드로 고정한다. 에픽 → 스토리 → 하위 작업의 하위 작업도 에픽 하위로 세고, 상시 라벨이 붙은
   * 완료 에픽은 완료 목록에 나오지 않는다.
   */
  @Test
  void epics_aggregateForPeriod() {
    // 에픽 A — 기한 11/11, 11/14 완료(3일 늦음). 하위 3건 DONE, 그중 하나는 스토리 아래 하위 작업.
    long a = epic("에픽 A", "DONE", kst("2026-11-14T10:00:00"), LocalDate.parse("2026-11-11"));
    doneChild("A 작업", a, kst("2026-11-12T10:00:00"));
    long story = doneChild("A 스토리", a, kst("2026-11-13T10:00:00"));
    typeAs(story, "STORY");
    long sub = doneChild("A 하위 작업", story, kst("2026-11-13T11:00:00"));
    typeAs(sub, "SUBTASK");
    // 에픽 B — 기한 없음, 11/14 완료.
    long b = epic("에픽 B", "DONE", kst("2026-11-14T12:00:00"), null);
    // 지난 기간 에픽 C — 기한 11/6, 11/3 완료(3일 앞당김).
    long c = epic("에픽 C", "DONE", kst("2026-11-03T10:00:00"), LocalDate.parse("2026-11-06"));
    // 상시 에픽 S — 기간 안 DONE 하위 2건(하나는 AI 탐색).
    long s = epic("결함 처리", "IN_PROGRESS", null, null);
    label(s, ProjectReportEpics.ONGOING_LABEL);
    long found = doneChild("AI 가 찾은 결함", s, kst("2026-11-10T10:00:00"));
    label(found, ProjectReportEpics.AI_TESTER_LABEL);
    doneChild("사람이 찾은 결함", s, kst("2026-11-11T10:00:00"));
    // 상시 라벨이 붙은 완료 에픽 — 완료 목록에 나오지 않는다.
    long ongoingDone = epic("상시 완료", "DONE", kst("2026-11-12T10:00:00"), null);
    label(ongoingDone, ProjectReportEpics.ONGOING_LABEL);
    // 진행 중 에픽 P — 하위 4건 중 2건 기간 안 DONE, 남은 2건은 사람 담당·할 일.
    long p = epic("에픽 P", "IN_PROGRESS", null, null);
    doneChild("P 하나", p, kst("2026-11-10T10:00:00"));
    doneChild("P 둘", p, kst("2026-11-11T10:00:00"));
    long p3 = issue("P 셋", "TODO", OLD, null);
    parent(p3, p);
    assign(p3, owner);
    comment(p3, "기다리는 중", kst("2026-11-12T10:00:00"));
    long p4 = issue("P 넷", "TODO", OLD, null);
    parent(p4, p);
    assign(p4, owner);
    // 에픽 없는 DONE 이슈.
    closed("DONE", kst("2026-11-12T15:00:00"));
    // 이번 기간 릴리스 1회.
    dsl.insertInto(PROJECT_VERSION)
        .set(PROJECT_VERSION.PROJECT_ID, project.id())
        .set(PROJECT_VERSION.NAME, "v1")
        .set(PROJECT_VERSION.RELEASED_AT, kst("2026-11-13T10:00:00"))
        .execute();

    ProjectReportEpics e = compute(Optional.empty()).epics();

    assertThat(e.completed())
        .extracting(ProjectReportEpics.CompletedEpic::key)
        .containsExactly(keyOf(a), keyOf(b));
    var ca = e.completed().get(0);
    assertThat(ca.lateDays()).isEqualTo(3);
    assertThat(ca.dueDate()).isEqualTo("11/11");
    assertThat(ca.completedDate()).isEqualTo("11/14");
    assertThat(ca.children()).isEqualTo(3);
    assertThat(ca.doneChildren()).containsExactly("A 하위 작업", "A 스토리", "A 작업");
    String base = baseUrl.endsWith("/") ? baseUrl.substring(0, baseUrl.length() - 1) : baseUrl;
    assertThat(ca.url())
        .isEqualTo(base + "/projects/" + project.key() + "/issues/" + keyOf(a).split("-")[1]);
    assertThat(e.completed().get(1).lateDays()).isNull();
    assertThat(e.completed().get(1).dueDate()).isNull();

    assertThat(e.previousCompleted())
        .extracting(ProjectReportEpics.PastEpic::key)
        .containsExactly(keyOf(c));
    assertThat(e.previousCompleted().get(0).lateDays()).isEqualTo(-3);

    assertThat(e.inProgress())
        .extracting(ProjectReportEpics.InProgressEpic::key)
        .containsExactly(keyOf(p));
    var ip = e.inProgress().get(0);
    assertThat(ip.done()).isEqualTo(2);
    assertThat(ip.total()).isEqualTo(4);
    assertThat(ip.doneThisPeriod()).isEqualTo(2);
    assertThat(ip.doneChildren()).containsExactly("P 둘", "P 하나");
    assertThat(ip.remaining()).hasSize(2);
    assertThat(ip.remaining()).allSatisfy(r -> assertThat(r.assignee()).isEqualTo("김담당(사람)"));
    assertThat(ip.remaining().get(0).key()).isEqualTo(keyOf(p3));
    assertThat(ip.remaining().get(0).lastComment()).isEqualTo("기다리는 중");
    assertThat(ip.remaining().get(0).status()).isNotBlank();

    assertThat(e.ongoing()).hasSize(1);
    var og = e.ongoing().get(0);
    assertThat(og.title()).isEqualTo("결함 처리");
    assertThat(og.doneThisPeriod()).isEqualTo(2);
    assertThat(og.foundByAiTester()).isEqualTo(1);
    assertThat(og.doneTitles()).contains("AI 가 찾은 결함 [AI 탐색]", "사람이 찾은 결함");

    assertThat(e.noEpicDone()).isEqualTo(1);
    assertThat(e.noEpicDoneTitles()).hasSize(1);
    assertThat(e.upcomingWithDue()).isEmpty();

    assertThat(e.decisionCandidates())
        .extracting(ProjectReportEpics.DecisionCandidate::kind)
        .containsExactly(ProjectReportEpics.NO_NEXT_EPIC, ProjectReportEpics.BLOCKED_ON_HUMAN);
    assertThat(e.decisionCandidates().get(0).detail()).isEqualTo("진행 중 에픽 1개 외에 앞으로 기한을 정한 에픽이 없음");
    assertThat(e.decisionCandidates().get(0).owner()).isEqualTo("김담당");
    var blocked = e.decisionCandidates().get(1);
    assertThat(blocked.epic()).isEqualTo(keyOf(p));
    assertThat(blocked.detail()).isEqualTo("남은 2건이 모두 사람(김담당) 담당·할 일 상태");
    assertThat(blocked.owner()).isEqualTo("김담당");

    assertThat(e.metrics())
        .extracting(ProjectReportEpics.ReportMetric::label)
        .containsExactly("완료한 에픽", "기한 내 완료", "완료한 이슈", "릴리스", "기한 초과 미완료 이슈");
    assertThat(e.metrics().get(0).current()).isEqualTo("2");
    assertThat(e.metrics().get(0).previous()).isEqualTo("1");
    assertThat(e.metrics().get(1).current()).isEqualTo("0/1");
    assertThat(e.metrics().get(1).previous()).isEqualTo("1/1");
    assertThat(e.metrics().get(3).current()).isEqualTo("1회");
    assertThat(e.metrics().get(3).previous()).isEqualTo("0회");
    assertThat(e.metrics().get(4).previous()).isEqualTo("—");
    assertThat(e.projectOwner()).isEqualTo("김담당");
  }

  /** 지난 기간에 닫힌(또는 취소된) 에픽 아래에서 이번 기간 끝낸 이슈는 에픽 밖 완료로 센다(WP-1629). */
  @Test
  void epics_doneUnderEarlierClosedEpic_countsAsOutsideEpic() {
    long old = epic("지난 에픽", "DONE", kst("2026-11-03T10:00:00"), null);
    long cancelled = epic("취소 에픽", "CANCELED", kst("2026-11-04T10:00:00"), null);
    doneChild("지난 에픽 뒤늦은 일", old, kst("2026-11-12T10:00:00"));
    doneChild("취소 에픽 뒤늦은 일", cancelled, kst("2026-11-13T10:00:00"));

    ProjectReportEpics e = compute(Optional.empty()).epics();

    assertThat(e.noEpicDone()).isEqualTo(2);
    assertThat(e.noEpicDoneTitles()).containsExactly("취소 에픽 뒤늦은 일", "지난 에픽 뒤늦은 일");
  }

  /** 지난 기간보다 앞에 닫힌 에픽은 보고에 나오지 않아 읽지 않는다 — 그 아래 이번 기간 완료는 에픽 밖 완료(WP-1629 리뷰, 에픽 읽기 범위). */
  @Test
  void epics_longClosedEpic_notReported_childCountsOutsideEpic() {
    long old = epic("오래전 에픽", "DONE", kst("2026-10-01T10:00:00"), null);
    doneChild("오래전 에픽 뒤늦은 일", old, kst("2026-11-12T10:00:00"));

    ProjectReportEpics e = compute(Optional.empty()).epics();

    assertThat(e.completed()).isEmpty();
    assertThat(e.previousCompleted()).isEmpty();
    assertThat(e.inProgress()).isEmpty();
    assertThat(e.noEpicDone()).isEqualTo(1);
    assertThat(e.noEpicDoneTitles()).containsExactly("오래전 에픽 뒤늦은 일");
  }

  /**
   * 하위가 없는 열린 에픽이 기한을 넘기면 에픽 자신이 남은 일이라 위험이다(WP-1629). 예상 완료일을 낼 수 없어도 기한 초과 결정 후보에 든다(리뷰 반영 — 예상일이
   * 없다고 가장 늦은 에픽이 결정 요청에서 빠지지 않게).
   */
  @Test
  void epics_openEpicWithoutChildren_overdue_isRisk() {
    long empty = epic("빈 에픽", "IN_PROGRESS", null, LocalDate.parse("2026-11-10"));

    ProjectReportEpics e = compute(Optional.empty()).epics();
    var ip = e.inProgress();

    assertThat(ip).hasSize(1);
    assertThat(ip.get(0).status()).isEqualTo(ProjectReportEpics.RISK);
    assertThat(ip.get(0).projectedDate()).isNull();
    assertThat(e.decisionCandidates())
        .extracting(ProjectReportEpics.DecisionCandidate::kind)
        .containsExactly(
            ProjectReportEpics.NO_NEXT_EPIC, ProjectReportEpics.EPIC_OVERDUE_PROJECTED);
    var d = e.decisionCandidates().get(1);
    assertThat(d.epic()).isEqualTo(keyOf(empty));
    assertThat(d.detail()).isEqualTo("기한 11/10 지남, 예상 완료일을 계산할 수 없음(남은 하위 0건)");
    assertThat(d.owner()).isEqualTo("김담당");
  }

  /** 끝낸 하위가 없어 속도가 없는 기한 초과 에픽 — 예상일 없이 위험, 남은 하위 수를 담은 기한 초과 결정 후보(리뷰 반영). */
  @Test
  void epics_overdueWithoutVelocity_isDecisionCandidate() {
    long q = epic("멈춘 에픽", "IN_PROGRESS", null, LocalDate.parse("2026-11-10"));
    for (int i = 0; i < 2; i++) {
      long t = issue("멈춘 하위 " + i, "TODO", OLD, null);
      parent(t, q);
    }

    ProjectReportEpics e = compute(Optional.empty()).epics();

    assertThat(e.inProgress()).hasSize(1);
    assertThat(e.inProgress().get(0).status()).isEqualTo(ProjectReportEpics.RISK);
    assertThat(e.inProgress().get(0).projectedDate()).isNull();
    assertThat(e.decisionCandidates())
        .filteredOn(c -> c.kind().equals(ProjectReportEpics.EPIC_OVERDUE_PROJECTED))
        .singleElement()
        .satisfies(
            d -> {
              assertThat(d.epic()).isEqualTo(keyOf(q));
              assertThat(d.detail()).isEqualTo("기한 11/10 지남, 예상 완료일을 계산할 수 없음(남은 하위 2건)");
            });
  }

  /** 하위가 모두 닫힌 열린 에픽은 기한이 지났어도 남은 일이 없어 순조로움 — 예상 완료일·기한 초과 결정 후보 없음(WP-1629). */
  @Test
  void epics_openEpicAllChildrenClosed_pastDue_isOnTrack() {
    long q = epic("다 끝난 에픽", "IN_PROGRESS", null, LocalDate.parse("2026-11-10"));
    doneChild("끝 1", q, kst("2026-11-12T10:00:00"));
    doneChild("끝 2", q, kst("2026-11-13T10:00:00"));

    ProjectReportEpics e = compute(Optional.empty()).epics();

    assertThat(e.inProgress()).hasSize(1);
    assertThat(e.inProgress().get(0).status()).isEqualTo(ProjectReportEpics.ON_TRACK);
    assertThat(e.inProgress().get(0).projectedDate()).isNull();
    assertThat(e.decisionCandidates())
        .extracting(ProjectReportEpics.DecisionCandidate::kind)
        .doesNotContain(ProjectReportEpics.EPIC_OVERDUE_PROJECTED);
  }

  /** 하위 101건 에픽 — 제목은 100건 + 「외 1건」. */
  @Test
  void epics_doneChildrenCapAt100() {
    long big = epic("큰 에픽", "DONE", kst("2026-11-14T10:00:00"), null);
    for (int i = 0; i < 101; i++) {
      doneChild("하위 " + i, big, kst("2026-11-01T00:00:00").plusMinutes(i));
    }

    var completed = compute(Optional.empty()).epics().completed();

    assertThat(completed).hasSize(1);
    assertThat(completed.get(0).children()).isEqualTo(101);
    assertThat(completed.get(0).doneChildren()).hasSize(101);
    assertThat(completed.get(0).doneChildren().get(0)).isEqualTo("하위 100");
    assertThat(completed.get(0).doneChildren().get(100)).isEqualTo("외 1건");
  }

  /** 예상 완료일이 기한을 넘는 진행 중 에픽 — EPIC_OVERDUE_PROJECTED 후보, 상태 주의/위험. */
  @Test
  void epics_overdueProjected() {
    long q = epic("에픽 Q", "IN_PROGRESS", null, LocalDate.parse("2026-11-17"));
    doneChild("Q 끝", q, kst("2026-11-15T10:00:00"));
    for (int i = 0; i < 9; i++) {
      long t = issue("Q 남음 " + i, "TODO", OLD, null);
      parent(t, q);
    }

    ProjectReportEpics e = compute(Optional.empty()).epics();

    assertThat(e.inProgress()).hasSize(1);
    var ip = e.inProgress().get(0);
    assertThat(ip.status()).isIn(ProjectReportEpics.WARN, ProjectReportEpics.RISK);
    assertThat(ip.projectedDate()).isNotNull();
    assertThat(ip.dueDate()).isEqualTo("11/17");
    // 기한이 오늘 이후라 앞으로 기한을 정한 에픽이 있다 — NO_NEXT_EPIC 없음. 남은 일은 담당이 없어 사람 대기 아님.
    assertThat(e.upcomingWithDue()).hasSize(1);
    assertThat(e.decisionCandidates())
        .extracting(ProjectReportEpics.DecisionCandidate::kind)
        .containsExactly(ProjectReportEpics.EPIC_OVERDUE_PROJECTED);
    var d = e.decisionCandidates().get(0);
    assertThat(d.epic()).isEqualTo(keyOf(q));
    assertThat(d.detail()).startsWith("예상 완료 ").contains("로 기한(11/17)을 ").endsWith("일 넘김");
    assertThat(d.owner()).isEqualTo("김담당");
    assertThat(ip.remaining()).allSatisfy(r -> assertThat(r.assignee()).isEqualTo("없음"));
    assertThat(ip.remaining()).allSatisfy(r -> assertThat(r.lastComment()).isNull());
  }

  /** 에픽·이슈가 하나도 없는 프로젝트 — 빈 묶음, NO_NEXT_EPIC 하나, 예외 없음. */
  @Test
  void epics_emptyProject() {
    ProjectReportEpics e = compute(Optional.empty()).epics();

    assertThat(e.completed()).isEmpty();
    assertThat(e.previousCompleted()).isEmpty();
    assertThat(e.inProgress()).isEmpty();
    assertThat(e.upcomingWithDue()).isEmpty();
    assertThat(e.ongoing()).isEmpty();
    assertThat(e.noEpicDone()).isZero();
    assertThat(e.noEpicDoneTitles()).isEmpty();
    assertThat(e.decisionCandidates()).hasSize(1);
    assertThat(e.decisionCandidates().get(0).kind()).isEqualTo(ProjectReportEpics.NO_NEXT_EPIC);
    assertThat(e.decisionCandidates().get(0).detail()).isEqualTo("앞으로 기한을 정한 에픽이 없음");
    assertThat(e.metrics()).hasSize(5);
    assertThat(e.metrics().get(1).current()).isEqualTo("—");
    assertThat(e.metrics().get(3).current()).isEqualTo("0회");
  }

  /** 기한 초과 지표의 지난 값은 지난 리포트 스냅숏의 기한 지남 수다. */
  @Test
  void epics_overdueMetric_vsLastSnapshot() {
    long late = open(OLD);
    due(late, LocalDate.parse("2026-11-10"));

    ProjectReportEpics e =
        compute(Optional.of(new ReportSnapshot(0, 0, 1, 3, StatusBadge.ON_TRACK.name()))).epics();

    assertThat(e.metrics().get(4))
        .isEqualTo(new ProjectReportEpics.ReportMetric("기한 초과 미완료 이슈", "1", "3"));
  }

  /** 남은 하위에 AI 담당이 있으면 「AI」 이고 사람 대기 후보가 아니다. 기한 초과 남은 하위에는 마지막 댓글을 싣는다. */
  @Test
  void epics_agentAssignee_andOverdueComment() {
    long agent = TestFixtures.createAgentNoToken(dsl);
    long p = epic("에픽 AI", "IN_PROGRESS", null, null);
    doneChild("끝", p, kst("2026-11-10T10:00:00"));
    long t = issue("AI 할 일", "IN_PROGRESS", OLD, null);
    parent(t, p);
    assign(t, agent);
    due(t, LocalDate.parse("2026-11-12"));
    comment(t, "진행 중 메모", kst("2026-11-12T10:00:00"));

    ProjectReportEpics e = compute(Optional.empty()).epics();

    var r = e.inProgress().get(0).remaining().get(0);
    assertThat(r.assignee()).isEqualTo("AI");
    assertThat(r.lastComment()).isEqualTo("진행 중 메모");
    assertThat(e.decisionCandidates())
        .extracting(ProjectReportEpics.DecisionCandidate::kind)
        .doesNotContain(ProjectReportEpics.BLOCKED_ON_HUMAN);
  }
}
