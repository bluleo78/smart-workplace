package com.workplace.issue.report;

import static com.workplace.jooq.Tables.AGENT_WORK;
import static com.workplace.jooq.Tables.AGENT_WORK_EVENT;
import static com.workplace.jooq.Tables.ISSUE;
import static com.workplace.jooq.Tables.ISSUE_ASSIGNEE;
import static com.workplace.jooq.Tables.ISSUE_HISTORY;
import static com.workplace.jooq.Tables.ISSUE_LABEL;
import static com.workplace.jooq.Tables.ISSUE_TYPE_DEF;
import static com.workplace.jooq.Tables.LABEL;
import static com.workplace.jooq.Tables.PROJECT;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.tuple;

import com.workplace.issue.dto.CreateIssueRequest;
import com.workplace.issue.dto.MeDaySummary;
import com.workplace.issue.report.PersonalReportWork.EpicWork;
import com.workplace.issue.report.PersonalReportWork.ProjectWork;
import com.workplace.issue.service.IssueService;
import com.workplace.issue.service.MeOverviewService;
import com.workplace.project.dto.CreateProjectRequest;
import com.workplace.project.dto.ProjectResponse;
import com.workplace.project.service.ProjectService;
import com.workplace.support.ExternalClientMockedTestBase;
import com.workplace.support.TestFixtures;
import com.workplace.wiki.report.ReportTableSpec;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.time.YearMonth;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.test.util.AopTestUtils;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.transaction.annotation.Transactional;

/**
 * 개인 보고 계산값(WP-1486) — 숫자가 「내 작업 · 개요」와 같은 정의(지표 모듈·열린 이슈 판정)로 나오는지, 상태 바꿈의 범위(내가 바꿨거나 지금 내 담당, 읽을
 * 수 있는 프로젝트, 서울 날짜 경계), 일일·주간·월간 표 모양, AI 재료 이슈의 이유 순서·상한 밖 묶음을 시드 이슈로 고정한다.
 *
 * <p>「지금」은 2026-11-12 09:00 KST, 기본 회차는 일일 11-11(어제). 이슈는 {@link ProjectReportFactsServiceTest} 처럼
 * 담당자·이력 없이 만든 뒤 상태·시각을 직접 덮어쓴다.
 */
@Transactional
class PersonalReportFactsServiceTest extends ExternalClientMockedTestBase {

  private static final OffsetDateTime NOW = OffsetDateTime.parse("2026-11-12T09:00:00+09:00");
  private static final PersonalReportPeriod YESTERDAY =
      PersonalReportPeriod.daily(LocalDate.parse("2026-11-11"));

  /** 어느 회차에도 들지 않는 생성 시각. */
  private static final OffsetDateTime OLD = OffsetDateTime.parse("2026-06-01T12:00:00+09:00");

  @Autowired DSLContext dsl;
  @Autowired ProjectService projectService;
  @Autowired IssueService issueService;
  @Autowired MeOverviewService overviewService;
  @Autowired PersonalReportFactsService service;

  private long me;
  private long ai;
  private ProjectResponse project;

  @BeforeEach
  void seed() {
    me = TestFixtures.createHuman(dsl);
    grantUserRole(me);
    withMembership(me);
    ai = createAgentUser("pr-ai");
    project = newProject(me);
  }

  // ───────────── 시드 헬퍼 ─────────────

  private static OffsetDateTime kst(String localDateTime) {
    return OffsetDateTime.parse(localDateTime + "+09:00");
  }

  private ProjectResponse newProject(long owner) {
    String suffix = UUID.randomUUID().toString().replaceAll("-", "").toUpperCase().substring(0, 4);
    return projectService.create(
        owner, new CreateProjectRequest("PR" + suffix, "개인-" + suffix, "x", "TEAM"));
  }

  /** reporter 가 p 에 만든 담당자·이력 없는 이슈 — 범주·생성 시각·닫힌 시각을 덮어쓴다. */
  private long issue(
      long reporter,
      ProjectResponse p,
      String status,
      OffsetDateTime createdAt,
      OffsetDateTime closedAt) {
    var created =
        issueService.create(
            reporter,
            p.key(),
            new CreateIssueRequest(
                "이슈-" + UUID.randomUUID().toString().substring(0, 6),
                null,
                null,
                null,
                null,
                null,
                null,
                null));
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

  /** 내 프로젝트의 오래된 열린 이슈. */
  private long open() {
    return issue(me, project, "TODO", OLD, null);
  }

  /** 내가 담당한 채 closedAt 에 닫힌 오래된 이슈. */
  private long closedMine(String status, OffsetDateTime closedAt) {
    long id = issue(me, project, status, OLD, closedAt);
    assign(id, me);
    return id;
  }

  private void assign(long issueId, long userId) {
    dsl.insertInto(ISSUE_ASSIGNEE)
        .set(ISSUE_ASSIGNEE.ISSUE_ID, issueId)
        .set(ISSUE_ASSIGNEE.USER_ID, userId)
        .set(ISSUE_ASSIGNEE.ASSIGNED_BY, userId)
        .execute();
  }

  private void due(long issueId, LocalDate due) {
    dsl.update(ISSUE).set(ISSUE.DUE_DATE, due).where(ISSUE.ID.eq(issueId)).execute();
  }

  /** actor 가 at 에 상태를 바꾼 이력 한 줄. */
  private void statusChanged(long issueId, long actor, OffsetDateTime at) {
    dsl.insertInto(ISSUE_HISTORY)
        .set(ISSUE_HISTORY.ISSUE_ID, issueId)
        .set(ISSUE_HISTORY.ACTOR_ID, actor)
        .set(ISSUE_HISTORY.EVENT_TYPE, "STATUS_CHANGED")
        .set(ISSUE_HISTORY.FROM_VALUE, "TODO")
        .set(ISSUE_HISTORY.TO_VALUE, "IN_PROGRESS")
        .set(ISSUE_HISTORY.CREATED_AT, at)
        .execute();
  }

  /** AI 가 사람 답을 기다리는 진행 중 작업 — 개요 「AI 답변 기다림」. */
  private void waitingForAnswer(long issueId, OffsetDateTime at) {
    Long workId =
        dsl.insertInto(AGENT_WORK)
            .set(AGENT_WORK.ISSUE_ID, issueId)
            .set(AGENT_WORK.WORKER_ID, ai)
            .set(AGENT_WORK.STATE, "INPUT_REQUIRED")
            .set(AGENT_WORK.STARTED_AT, at)
            .set(AGENT_WORK.STATE_CHANGED_AT, at)
            .returning(AGENT_WORK.ID)
            .fetchOne()
            .getId();
    dsl.insertInto(AGENT_WORK_EVENT)
        .set(AGENT_WORK_EVENT.WORK_ID, workId)
        .set(AGENT_WORK_EVENT.STATE, "INPUT_REQUIRED")
        .set(AGENT_WORK_EVENT.CREATED_AT, at)
        .execute();
  }

  private void epicParent(long childId, long epicId) {
    Long typeId =
        dsl.select(ISSUE_TYPE_DEF.ID)
            .from(ISSUE_TYPE_DEF)
            .where(ISSUE_TYPE_DEF.PROJECT_ID.eq(project.id()))
            .and(ISSUE_TYPE_DEF.NAME.eq("EPIC"))
            .fetchOne(ISSUE_TYPE_DEF.ID);
    dsl.update(ISSUE).set(ISSUE.TYPE_ID, typeId).where(ISSUE.ID.eq(epicId)).execute();
    dsl.update(ISSUE).set(ISSUE.PARENT_ISSUE_ID, epicId).where(ISSUE.ID.eq(childId)).execute();
  }

  private PersonalReportFacts daily() {
    return service.compute(me, YESTERDAY, NOW);
  }

  /** 세로 표(주간·월간)에서 첫 칸이 label 인 행. */
  private static List<String> row(PersonalReportFacts f, String label) {
    return f.table().body().stream().filter(r -> r.get(0).equals(label)).findFirst().orElseThrow();
  }

  // ───────────── 숫자 ─────────────

  @Test
  void daily_numbersMatchOverviewDaySummary() {
    long onTime = closedMine("DONE", kst("2026-11-11T10:00:00"));
    due(onTime, LocalDate.parse("2026-11-11"));
    long late = closedMine("DONE", kst("2026-11-11T18:00:00"));
    due(late, LocalDate.parse("2026-11-05"));
    issue(me, project, "TODO", kst("2026-11-11T11:00:00"), null);

    PersonalReportFacts f = daily();
    // 개요 「어제」 칸 — 시각을 받는 판은 같은 패키지 전용이라 대상 객체에 직접 부른다.
    Object target = AopTestUtils.getTargetObject(overviewService);
    MeDaySummary day = ReflectionTestUtils.invokeMethod(target, "today", me, NOW);

    assertThat(day.yesterday()).isEqualTo(YESTERDAY.start());
    assertThat(f.completed()).isEqualTo(day.yesterdayCompleted()).isEqualTo(2);
    assertThat(f.created()).isEqualTo(day.yesterdayCreated()).isEqualTo(1);
    assertThat(f.table().body().get(0).get(0))
        .isEqualTo("2 · 기한 내 " + day.yesterdayCompletedOnTime());
    assertThat(f.table().body().get(0).get(3)).isEqualTo(String.valueOf(day.overdue()));
  }

  @Test
  void daily_table_tailZerosOmitted() {
    long a = closedMine("DONE", kst("2026-11-11T10:00:00"));
    closedMine("DONE", kst("2026-11-11T12:00:00"));

    PersonalReportFacts f = daily();
    assertThat(f.table().headCells()).containsExactly("끝냄", "새로 만듦", "상태 바꿈", "기한 지남");
    assertThat(f.table().body()).hasSize(1);
    assertThat(f.table().body().get(0).get(0)).isEqualTo("2");
    assertThat(f.table().insertSectionTitle()).isEqualTo("어제 숫자");
    assertThat(f.table().insertAfterSections()).containsExactly("한 줄", "막힌 것");
    assertThat(f.table().headFirstCell().test("끝냄")).isTrue();

    due(a, LocalDate.parse("2026-11-20"));
    assertThat(daily().table().body().get(0).get(0)).isEqualTo("2 · 기한 내 1");
  }

  @Test
  void daily_table_withAiTail() {
    long a = closedMine("DONE", kst("2026-11-11T10:00:00"));
    assign(a, ai);
    due(a, LocalDate.parse("2026-11-20"));

    assertThat(daily().table().body().get(0).get(0)).isEqualTo("1 · 기한 내 1 · AI와 함께 1");
  }

  /**
   * 끝낸 일 중 AI와 함께 건수(WP-1632) — 끝냄 3 중 AI 담당이 낀 1건만 AI와 함께. 직접 건수(끝냄 − AI와 함께)는 요청을 만들 때 {@code
   * CompletedSplit.of} 가 정한다.
   */
  @Test
  void completedWithAi_countsOnlyAiAssignedDone() {
    long a = closedMine("DONE", kst("2026-11-11T10:00:00"));
    assign(a, ai);
    closedMine("DONE", kst("2026-11-11T12:00:00"));
    closedMine("DONE", kst("2026-11-11T14:00:00"));

    PersonalReportFacts f = daily();

    assertThat(f.completed()).isEqualTo(3);
    assertThat(f.completedWithAi()).isEqualTo(1);
  }

  /**
   * 이슈 담당 kind(WP-1632) — 사람·AI 가 함께 담당한 이슈는 assigneesDetail 에 이름순으로 kind 와 함께 실린다(기존 assignees 도
   * 그대로).
   */
  @Test
  void issues_assigneesDetail_carriesHumanAndAgentKind() {
    long id = closedMine("DONE", kst("2026-11-11T10:00:00"));
    assign(id, ai);

    ReportIssue issue = daily().issues().get(0);

    assertThat(issue.assigneesDetail())
        .extracting(ReportAssignee::name)
        .containsExactlyElementsOf(issue.assignees());
    assertThat(issue.assigneesDetail())
        .extracting(ReportAssignee::kind)
        .containsExactlyInAnyOrder("HUMAN", "AGENT");
    assertThat(issue.assigneesDetail())
        .filteredOn(a -> a.kind().equals("AGENT"))
        .extracting(ReportAssignee::name)
        .containsExactly("pr-ai");
  }

  @Test
  void statusChanged_byOtherOnMyAssignedIssue_counts() {
    long id = open();
    assign(id, me);
    statusChanged(id, ai, kst("2026-11-11T10:00:00"));

    PersonalReportFacts f = daily();
    assertThat(f.statusChanged()).isEqualTo(1);
    assertThat(f.isEmpty()).isFalse();
    assertThat(f.table().body().get(0).get(2)).isEqualTo("1");
  }

  @Test
  void statusChanged_byOtherOnIssueNotMine_excluded() {
    long id = open();
    statusChanged(id, ai, kst("2026-11-11T10:00:00"));

    assertThat(daily().statusChanged()).isZero();
  }

  @Test
  void statusChanged_byMeOnIssueNotAssigned_counts() {
    long id = open();
    statusChanged(id, me, kst("2026-11-11T10:00:00"));
    // 같은 이슈를 두 번 바꿔도 한 건.
    statusChanged(id, me, kst("2026-11-11T11:00:00"));

    assertThat(daily().statusChanged()).isEqualTo(1);
  }

  @Test
  void canceled_isNotCompleted() {
    closedMine("CANCELED", kst("2026-11-11T10:00:00"));

    PersonalReportFacts f = daily();
    assertThat(f.completed()).isZero();
    assertThat(f.issues()).isEmpty();
  }

  @Test
  void kstBoundary_0030kstCountsAsThatDay() {
    long id = open();
    // 2026-11-10T15:30Z = 11-11 00:30 KST.
    statusChanged(id, me, OffsetDateTime.parse("2026-11-10T15:30:00Z"));

    assertThat(daily().statusChanged()).isEqualTo(1);
    assertThat(
            service
                .compute(me, PersonalReportPeriod.daily(LocalDate.parse("2026-11-10")), NOW)
                .statusChanged())
        .isZero();
  }

  @Test
  void empty_whenNoActivity() {
    PersonalReportFacts f = daily();

    assertThat(f.isEmpty()).isTrue();
    assertThat(f.completed()).isZero();
    assertThat(f.created()).isZero();
    assertThat(f.statusChanged()).isZero();
    assertThat(f.table().body()).containsExactly(List.of("0", "0", "0", "0"));
    assertThat(f.issues()).isEmpty();
    assertThat(f.omittedByGroup()).isEmpty();
  }

  // ───────────── 이슈 재료 ─────────────

  @Test
  void issues_orderAndReasons() {
    // 생성 순서를 이유 순서와 거꾸로 — 정렬이 id 가 아니라 이유로 됨을 본다.
    issue(me, project, "TODO", kst("2026-11-11T15:00:00"), null);
    long changed = open();
    statusChanged(changed, me, kst("2026-11-11T14:00:00"));
    long done = closedMine("DONE", kst("2026-11-11T10:00:00"));
    due(done, LocalDate.parse("2026-11-10"));
    assign(done, ai);
    long dueToday = open();
    assign(dueToday, me);
    due(dueToday, LocalDate.parse("2026-11-12"));
    long waiting = open();
    waitingForAnswer(waiting, kst("2026-11-10T10:00:00"));
    long overdue = open();
    assign(overdue, me);
    due(overdue, LocalDate.parse("2026-11-05"));
    // 기한 지난 내 담당 이슈를 어제 바꾸기도 했다 — 앞 이유(OVERDUE) 하나로만 실린다.
    statusChanged(overdue, me, kst("2026-11-11T09:00:00"));

    PersonalReportFacts f = daily();

    assertThat(f.issues())
        .extracting(ReportIssue::reason)
        .containsExactly("OVERDUE", "WAITING", "DUE_TODAY", "DONE", "STATUS_CHANGED", "CREATED");
    ReportIssue doneIssue = f.issues().get(3);
    assertThat(doneIssue.lateDays()).isEqualTo(1);
    assertThat(doneIssue.withAi()).isTrue();
    assertThat(f.issues()).allSatisfy(i -> assertThat(i.project()).isEqualTo(project.name()));
    assertThat(f.issues().get(0).dueDate()).isEqualTo(LocalDate.parse("2026-11-05"));
    assertThat(f.issues().get(0).lateDays()).isNull();
    assertThat(f.issues().get(0).withAi()).isFalse();
    assertThat(f.issues())
        .extracting(ReportIssue::key)
        .doesNotHaveDuplicates()
        .hasSize(6)
        .doesNotContainNull();
    assertThat(f.statusChanged()).isEqualTo(2);
  }

  @Test
  void weekly_openIssuesAddedAfterOtherReasons() {
    long a = open();
    assign(a, me);
    PersonalReportPeriod week = PersonalReportPeriod.weekly(LocalDate.parse("2026-11-02"));

    assertThat(service.compute(me, week, NOW).issues())
        .extracting(ReportIssue::reason)
        .containsExactly("OPEN");
    // 일일에는 진행 중 이슈를 싣지 않는다.
    assertThat(daily().issues()).isEmpty();
  }

  @Test
  void issueLimit_overflowGroupedByEpicOrProject() {
    long epic = open();
    // 오래된 순으로 만든다 — 최신순 정렬에서 맨 뒤 다섯(처음 만든 다섯)이 밀린다.
    for (int i = 0; i < 45; i++) {
      long id = issue(me, project, "TODO", kst("2026-11-11T01:00:00").plusMinutes(i), null);
      if (i < 3) epicParent(id, epic);
    }
    String epicTitle =
        dsl.select(ISSUE.TITLE).from(ISSUE).where(ISSUE.ID.eq(epic)).fetchOne(ISSUE.TITLE);

    PersonalReportFacts f = daily();

    assertThat(f.issues()).hasSize(PersonalReportFactsService.DETAIL_LIMIT);
    assertThat(f.omittedByGroup().values().stream().mapToInt(Integer::intValue).sum()).isEqualTo(5);
    assertThat(f.omittedByGroup()).isEqualTo(Map.of(epicTitle, 3, project.name(), 2));
  }

  @Test
  void otherUsersIssues_unreadable_excluded() {
    long stranger = TestFixtures.createHuman(dsl);
    grantUserRole(stranger);
    withMembership(stranger);
    ProjectResponse hidden = newProject(stranger);
    long id = issue(stranger, hidden, "TODO", OLD, null);
    assign(id, me);
    statusChanged(id, me, kst("2026-11-11T10:00:00"));
    long done = issue(stranger, hidden, "DONE", OLD, kst("2026-11-11T10:00:00"));
    assign(done, me);

    PersonalReportFacts f = daily();
    assertThat(f.statusChanged()).isZero();
    assertThat(f.completed()).isZero();
    assertThat(f.issues()).isEmpty();
  }

  // ───────────── 주간·월간 표 ─────────────

  @Test
  void weekly_previousColumnFromPreviousWeek() {
    for (int i = 0; i < 3; i++) closedMine("DONE", kst("2026-10-28T10:00:00").plusHours(i));
    for (int i = 0; i < 5; i++) closedMine("DONE", kst("2026-11-04T10:00:00").plusHours(i));

    PersonalReportFacts f =
        service.compute(me, PersonalReportPeriod.weekly(LocalDate.parse("2026-11-02")), NOW);

    assertThat(f.table().headCells()).containsExactly("지난주 대비", "이번 주", "변화");
    assertThat(f.table().insertSectionTitle()).isEqualTo("지난주 대비");
    assertThat(f.table().insertAfterSections()).containsExactly("한 줄", "막힌 것");
    assertThat(f.table().body())
        .extracting(r -> r.get(0))
        .containsExactly("끝냄", "그중 AI와 함께", "기한 내", "기한 초과", "새로 만듦", "평균 소요", "기한 지남(지금)");
    assertThat(row(f, "끝냄")).containsExactly("끝냄", "5", "+2");
    assertThat(row(f, "기한 지남(지금)")).containsExactly("기한 지남(지금)", "0", "—");
    assertThat(f.table().headFirstCell().test("지난주 대비")).isTrue();
    assertThat(f.completed()).isEqualTo(5);
  }

  @Test
  void monthly_headUsesMonthWords_previousIsCalendarMonth() {
    closedMine("DONE", kst("2026-10-15T10:00:00"));
    // 8월 31일 — 같은 길이(31일) 앞 기간(8/31~9/30)에는 들지만 지난 달력 달(9월)에는 안 든다.
    closedMine("DONE", kst("2026-08-31T10:00:00"));
    closedMine("DONE", kst("2026-09-15T10:00:00"));

    PersonalReportFacts f =
        service.compute(me, PersonalReportPeriod.monthly(YearMonth.of(2026, 10)), NOW);

    assertThat(f.table().headCells()).containsExactly("지난달 대비", "이번 달", "변화");
    assertThat(f.table().insertSectionTitle()).isEqualTo("지난달 대비");
    assertThat(row(f, "끝냄")).containsExactly("끝냄", "1", "0");
  }

  // ───────────── 끝낸 일 집계(WP-1632) — 프로젝트 → 에픽 ─────────────

  private static final PersonalReportPeriod WEEK =
      PersonalReportPeriod.weekly(LocalDate.parse("2026-11-02"));

  /** 주 안의 닫힌 시각 — 분만 바꿔 순서를 정한다(분이 클수록 최근). */
  private static OffsetDateTime inWeek(int minutes) {
    return kst("2026-11-04T10:00:00").plusMinutes(minutes);
  }

  /** p 프로젝트의 EPIC 유형 이슈(만든 사람 me, 담당 없음) — status·closedAt 를 정한다. */
  private long epicIn(ProjectResponse p, String status, OffsetDateTime closedAt) {
    long id = issue(me, p, status, OLD, closedAt);
    Long typeId =
        dsl.select(ISSUE_TYPE_DEF.ID)
            .from(ISSUE_TYPE_DEF)
            .where(ISSUE_TYPE_DEF.PROJECT_ID.eq(p.id()))
            .and(ISSUE_TYPE_DEF.NAME.eq("EPIC"))
            .fetchOne(ISSUE_TYPE_DEF.ID);
    dsl.update(ISSUE).set(ISSUE.TYPE_ID, typeId).where(ISSUE.ID.eq(id)).execute();
    return id;
  }

  /** p 프로젝트에서 내가 담당한 채 closedAt 에 DONE 된 이슈, 부모가 있으면 부모 아래. */
  private long doneIn(ProjectResponse p, Long parentId, OffsetDateTime closedAt) {
    long id = issue(me, p, "DONE", OLD, closedAt);
    assign(id, me);
    if (parentId != null) {
      dsl.update(ISSUE).set(ISSUE.PARENT_ISSUE_ID, parentId).where(ISSUE.ID.eq(id)).execute();
    }
    return id;
  }

  /** 이슈 프로젝트의 라벨을 (없으면 만들어) 붙인다. */
  private void label(long issueId, ProjectResponse p, String name) {
    Long labelId =
        dsl.select(LABEL.ID)
            .from(LABEL)
            .where(LABEL.PROJECT_ID.eq(p.id()))
            .and(LABEL.NAME.eq(name))
            .fetchOne(LABEL.ID);
    if (labelId == null) {
      labelId =
          dsl.insertInto(LABEL)
              .set(LABEL.PROJECT_ID, p.id())
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

  private String keyOf(long issueId) {
    var r =
        dsl.select(ISSUE.NUMBER, ISSUE.PROJECT_ID)
            .from(ISSUE)
            .where(ISSUE.ID.eq(issueId))
            .fetchOne();
    String key =
        dsl.select(PROJECT.KEY)
            .from(PROJECT)
            .where(PROJECT.ID.eq(r.value2()))
            .fetchOne(PROJECT.KEY);
    return key + "-" + r.value1();
  }

  private String titleOf(long issueId) {
    return dsl.select(ISSUE.TITLE).from(ISSUE).where(ISSUE.ID.eq(issueId)).fetchOne(ISSUE.TITLE);
  }

  private PersonalReportFacts weekly() {
    return service.compute(me, WEEK, NOW);
  }

  /** 프로젝트는 끝낸 일 많은 순, 에픽은 많은 순·「에픽 없음」 맨 뒤, 제목은 최근 끝낸 순. 표는 프로젝트마다 한 행 「N건」. */
  @Test
  void weekly_doneByProject_groupsProjectThenEpic_noEpicLast() {
    ProjectResponse other = newProject(me);
    long epic = epicIn(project, "IN_PROGRESS", null);
    long older = doneIn(project, epic, inWeek(1));
    long newer = doneIn(project, epic, inWeek(5));
    long loose = doneIn(project, null, inWeek(3));
    doneIn(other, null, inWeek(2));

    PersonalReportFacts f = weekly();

    PersonalReportWork work = f.work();
    assertThat(work.projects())
        .extracting(ProjectWork::projectName, ProjectWork::done)
        .containsExactly(tuple(project.name(), 3), tuple(other.name(), 1));
    ProjectWork mine = work.projects().get(0);
    assertThat(mine.projectKey()).isEqualTo(project.key());
    assertThat(mine.epics())
        .extracting(EpicWork::title, EpicWork::done)
        .containsExactly(tuple(titleOf(epic), 2), tuple(PersonalReportWork.NO_EPIC, 1));
    EpicWork e = mine.epics().get(0);
    assertThat(e.key()).isEqualTo(keyOf(epic));
    assertThat(e.url())
        .endsWith("/projects/" + project.key() + "/issues/" + keyOf(epic).split("-")[1]);
    assertThat(e.epicDone()).isFalse();
    assertThat(e.doneTitles()).containsExactly(titleOf(newer), titleOf(older));
    EpicWork none = mine.epics().get(1);
    assertThat(none.key()).isNull();
    assertThat(none.url()).isNull();
    assertThat(none.doneTitles()).containsExactly(titleOf(loose));

    // 표 모양은 생성기가 집계에서 만든다(ReportTableSpec.personalWork).
    ReportTableSpec workTable =
        ReportTableSpec.personalWork(f.work().projects(), PersonalReportKind.WEEKLY);
    assertThat(workTable.headCells()).containsExactly("프로젝트", "끝낸 일", "주요 내용");
    assertThat(workTable.body())
        .containsExactly(List.of(project.name(), "3건", "—"), List.of(other.name(), "1건", "—"));
    assertThat(workTable.keepAi().columns()).containsExactly(2);
    assertThat(workTable.keepAi().rowKeys().get(0))
        .containsExactly(project.key(), project.name()); // 키 먼저(WP-1632 리뷰)
    assertThat(workTable.insertIntoSection().test("이번 주 한 일")).isTrue();
    assertThat(workTable.insertIntoSection().test("이번 달 한 일")).isTrue();
    assertThat(workTable.insertIntoSection().test("다음 주 할 일")).isFalse();
  }

  /** 프로젝트 합은 끝냄 건수와 같다 — 상세 이슈 목록(상한 40)에 담기지 않은 것까지 센다. */
  @Test
  void doneByProject_sumEqualsCompleted_over40() {
    long epic = epicIn(project, "IN_PROGRESS", null);
    for (int i = 0; i < 120; i++) doneIn(project, i % 2 == 0 ? epic : null, inWeek(i));

    PersonalReportFacts f = weekly();

    assertThat(f.completed()).isEqualTo(120);
    assertThat(f.work().total()).isEqualTo(120);
    assertThat(f.work().projects().get(0).epics())
        .extracting(EpicWork::done)
        .containsExactly(60, 60);
    assertThat(f.issues().size()).isLessThanOrEqualTo(PersonalReportFactsService.DETAIL_LIMIT);
  }

  /** 에픽 → 스토리 → 하위 작업의 하위 작업은 가장 가까운 에픽(조부모)으로 묶는다. */
  @Test
  void grandchild_groupedUnderNearestEpic() {
    long epic = epicIn(project, "IN_PROGRESS", null);
    long story = issue(me, project, "IN_PROGRESS", OLD, null);
    dsl.update(ISSUE).set(ISSUE.PARENT_ISSUE_ID, epic).where(ISSUE.ID.eq(story)).execute();
    doneIn(project, story, inWeek(1));

    EpicWork e = weekly().work().projects().get(0).epics().get(0);
    assertThat(e.key()).isEqualTo(keyOf(epic));
    assertThat(e.done()).isEqualTo(1);
  }

  /** 에픽이 내가 읽을 수 있는 다른 프로젝트에 있어도 묶음은 이슈의 프로젝트, 에픽 키는 에픽 프로젝트 키. */
  @Test
  void epicInOtherReadableProject_groupedUnderIssueProject() {
    ProjectResponse other = newProject(me);
    long epic = epicIn(other, "IN_PROGRESS", null);
    doneIn(project, epic, inWeek(1));

    PersonalReportWork work = weekly().work();
    assertThat(work.projects()).hasSize(1);
    assertThat(work.projects().get(0).projectKey()).isEqualTo(project.key());
    EpicWork e = work.projects().get(0).epics().get(0);
    assertThat(e.key()).isEqualTo(keyOf(epic)).startsWith(other.key() + "-");
    assertThat(e.title()).isEqualTo(titleOf(epic));
  }

  /** 에픽이 내가 읽을 수 없는 프로젝트에 있으면 제목을 숨기고 「에픽 없음」 으로 센다. */
  @Test
  void epicInUnreadableProject_fallsToNoEpic() {
    long stranger = TestFixtures.createHuman(dsl);
    grantUserRole(stranger);
    withMembership(stranger);
    ProjectResponse hidden = newProject(stranger);
    long epic = issue(stranger, hidden, "IN_PROGRESS", OLD, null);
    Long typeId =
        dsl.select(ISSUE_TYPE_DEF.ID)
            .from(ISSUE_TYPE_DEF)
            .where(ISSUE_TYPE_DEF.PROJECT_ID.eq(hidden.id()))
            .and(ISSUE_TYPE_DEF.NAME.eq("EPIC"))
            .fetchOne(ISSUE_TYPE_DEF.ID);
    dsl.update(ISSUE).set(ISSUE.TYPE_ID, typeId).where(ISSUE.ID.eq(epic)).execute();
    doneIn(project, epic, inWeek(1));

    PersonalReportWork work = weekly().work();
    assertThat(work.projects().get(0).epics())
        .singleElement()
        .satisfies(
            e -> {
              assertThat(e.key()).isNull();
              assertThat(e.title()).isEqualTo(PersonalReportWork.NO_EPIC);
              assertThat(e.done()).isEqualTo(1);
            });
  }

  /** 취소는 끝낸 일이 아니다. */
  @Test
  void canceled_excluded() {
    closedMine("CANCELED", inWeek(1));
    doneIn(project, null, inWeek(2));

    PersonalReportFacts f = weekly();
    assertThat(f.work().total()).isEqualTo(1).isEqualTo(f.completed());
  }

  /** 이번 주 내가 에픽 자체를 끝냈으면 그 에픽 묶음에 세고 epicDone 을 켠다. */
  @Test
  void epicItselfDone_epicDoneFlag() {
    long epic = epicIn(project, "DONE", inWeek(9));
    assign(epic, me);
    doneIn(project, epic, inWeek(1));

    PersonalReportFacts f = weekly();
    EpicWork e = f.work().projects().get(0).epics().get(0);
    assertThat(f.work().projects().get(0).epics()).hasSize(1);
    assertThat(e.key()).isEqualTo(keyOf(epic));
    assertThat(e.epicDone()).isTrue();
    assertThat(e.done()).isEqualTo(2);
    assertThat(f.work().total()).isEqualTo(f.completed());
  }

  /** 「상시」 에픽 표시와 「AI 탐색」 결함 수(에픽·프로젝트 합). */
  @Test
  void ongoingAndAiTesterCounts() {
    long epic = epicIn(project, "IN_PROGRESS", null);
    label(epic, project, ProjectReportEpics.ONGOING_LABEL);
    long a = doneIn(project, epic, inWeek(1));
    long b = doneIn(project, epic, inWeek(2));
    doneIn(project, epic, inWeek(3));
    long c = doneIn(project, null, inWeek(4));
    label(a, project, ProjectReportEpics.AI_TESTER_LABEL);
    label(b, project, ProjectReportEpics.AI_TESTER_LABEL);
    label(c, project, ProjectReportEpics.AI_TESTER_LABEL);

    ProjectWork p = weekly().work().projects().get(0);
    assertThat(p.foundByAiTester()).isEqualTo(3);
    EpicWork e = p.epics().get(0);
    assertThat(e.ongoing()).isTrue();
    assertThat(e.foundByAiTester()).isEqualTo(2);
    assertThat(p.epics().get(1).ongoing()).isFalse();
    assertThat(p.epics().get(1).foundByAiTester()).isEqualTo(1);
  }

  /** 에픽당 제목은 100건까지, 넘치면 「외 N건」. 건수는 모두 센다. */
  @Test
  void perEpicTitles_cappedWithRemainder() {
    long epic = epicIn(project, "IN_PROGRESS", null);
    for (int i = 0; i < 103; i++) doneIn(project, epic, inWeek(i));

    EpicWork e = weekly().work().projects().get(0).epics().get(0);
    assertThat(e.done()).isEqualTo(103);
    assertThat(e.doneTitles()).hasSize(ProjectReportEpics.TITLE_LIMIT + 1);
    assertThat(e.doneTitles().get(ProjectReportEpics.TITLE_LIMIT)).isEqualTo("외 3건");
  }

  /** 일일은 끝낸 일 집계가 없다. */
  @Test
  void daily_noWork() {
    closedMine("DONE", kst("2026-11-11T10:00:00"));

    PersonalReportFacts f = daily();
    assertThat(f.work()).isNull();
  }

  /** 월간은 달력 달(1일~말일) 안에 끝낸 일만 묶는다. */
  @Test
  void monthly_calendarMonthRange() {
    doneIn(project, null, kst("2026-10-15T10:00:00"));
    doneIn(project, null, kst("2026-09-30T23:30:00"));
    doneIn(project, null, kst("2026-11-01T00:30:00"));

    PersonalReportFacts f =
        service.compute(me, PersonalReportPeriod.monthly(YearMonth.of(2026, 10)), NOW);
    assertThat(f.work().total()).isEqualTo(1).isEqualTo(f.completed());
    assertThat(ReportTableSpec.personalWork(f.work().projects(), PersonalReportKind.MONTHLY).body())
        .containsExactly(List.of(project.name(), "1건", "—"));
  }
}
