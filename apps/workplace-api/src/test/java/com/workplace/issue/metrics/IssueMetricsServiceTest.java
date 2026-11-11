package com.workplace.issue.metrics;

import static com.workplace.jooq.Tables.AGENT_WORK;
import static com.workplace.jooq.Tables.AGENT_WORK_EVENT;
import static com.workplace.jooq.Tables.ISSUE;
import static com.workplace.jooq.Tables.ISSUE_ASSIGNEE;
import static com.workplace.jooq.Tables.PROJECT;
import static com.workplace.jooq.Tables.ROLE;
import static com.workplace.jooq.Tables.USER;
import static com.workplace.jooq.Tables.USER_ROLE;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.assertj.core.api.Assertions.within;

import com.workplace.global.dto.UserSummary;
import com.workplace.issue.dto.CreateIssueRequest;
import com.workplace.issue.dto.IssueDueWindow;
import com.workplace.issue.repository.AgentWorkRepository;
import com.workplace.issue.repository.IssueHistoryRepository;
import com.workplace.issue.service.IssueHistoryRecorder;
import com.workplace.issue.service.IssueService;
import com.workplace.project.dto.CreateProjectRequest;
import com.workplace.project.dto.ProjectResponse;
import com.workplace.project.exception.ProjectNotFoundException;
import com.workplace.project.service.ProjectService;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.TestFixtures;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.annotation.Transactional;

/**
 * WP-1476 — {@link IssueMetricsService} 통합 테스트. 실제 DB 에 이슈·이력·담당자·agent_work 를 시각을 명시해 넣고 정의(취소 제외,
 * 닫힐 당시 마감일, 다시 열림, 닫힐 때 담당자, 서울 자정, 빈 칸, AI와 함께, 권한, 지난 기간)를 고정한다.
 *
 * <p>이슈는 담당자·마감 없이 만들고 상태·시각은 직접 갱신한다 — 서비스가 남기는 행은 DB now()(테스트 날짜 기준 「닫힌 뒤」)라 재구성을 흐리기 때문.
 */
@Transactional
class IssueMetricsServiceTest extends IntegrationTestBase {

  @Autowired DSLContext dsl;
  @Autowired IssueService issueService;
  @Autowired ProjectService projectService;
  @Autowired IssueHistoryRepository historyRepository;
  @Autowired IssueMetricsService metricsService;
  @Autowired IssueHistoryRecorder historyRecorder;
  @Autowired AgentWorkRepository agentWorkRepository;

  /** 기본 기간 11-03(화) ~ 11-09(월), 7일. 지난 기간은 10-27 ~ 11-02. */
  private static final MetricsPeriod WEEK =
      new MetricsPeriod(LocalDate.of(2026, 11, 3), LocalDate.of(2026, 11, 9));

  private static OffsetDateTime t(String iso) {
    return OffsetDateTime.parse(iso);
  }

  private Long user(String prefix) {
    String suffix = UUID.randomUUID().toString().substring(0, 8);
    Long id =
        dsl.insertInto(USER)
            .set(USER.USERNAME, prefix + "-" + suffix)
            .set(USER.PASSWORD, "pw")
            .set(USER.NAME, prefix)
            .set(USER.EMAIL, prefix + "-" + suffix + "@example.com")
            .returning(USER.ID)
            .fetchOne()
            .getId();
    Long roleId = dsl.select(ROLE.ID).from(ROLE).where(ROLE.NAME.eq("USER")).fetchOne(ROLE.ID);
    dsl.insertInto(USER_ROLE).set(USER_ROLE.USER_ID, id).set(USER_ROLE.ROLE_ID, roleId).execute();
    return id;
  }

  private ProjectResponse project(Long ownerId, String type) {
    String suffix = UUID.randomUUID().toString().replaceAll("-", "").toUpperCase().substring(0, 4);
    return projectService.create(
        ownerId, new CreateProjectRequest("MT" + suffix, "P-MT" + suffix, "x", type));
  }

  /** 담당자·마감 없는 이슈를 만들고 생성 시각을 지정한다(서비스가 넣은 담당자 행이 있으면 지운다). */
  private long issue(Long reporter, ProjectResponse p, OffsetDateTime createdAt) {
    var created =
        issueService.create(
            reporter,
            p.key(),
            new CreateIssueRequest("m", null, null, null, null, null, null, null));
    dsl.deleteFrom(ISSUE_ASSIGNEE).where(ISSUE_ASSIGNEE.ISSUE_ID.eq(created.id())).execute();
    dsl.update(ISSUE).set(ISSUE.CREATED_AT, createdAt).where(ISSUE.ID.eq(created.id())).execute();
    return created.id();
  }

  /** 상태·닫힌 시각·현재 마감일을 직접 정한다(status_id 는 트리거가 맞춘다). */
  private void close(long issueId, String status, OffsetDateTime closedAt, LocalDate due) {
    dsl.update(ISSUE)
        .set(ISSUE.STATUS, status)
        .set(ISSUE.STATUS_ID, TestFixtures.defaultStatusId(ISSUE.PROJECT_ID, status))
        .set(ISSUE.CLOSED_AT, closedAt)
        .set(ISSUE.DUE_DATE, due)
        .where(ISSUE.ID.eq(issueId))
        .execute();
  }

  private void assign(long issueId, long userId, long by) {
    dsl.insertInto(ISSUE_ASSIGNEE)
        .set(ISSUE_ASSIGNEE.ISSUE_ID, issueId)
        .set(ISSUE_ASSIGNEE.USER_ID, userId)
        .set(ISSUE_ASSIGNEE.ASSIGNED_BY, by)
        .execute();
  }

  /** IssueHistoryRecorder 와 같은 모양의 담당자 변경 payload. */
  private static String person(long id, String kind) {
    return "{\"id\":"
        + id
        + ",\"username\":\"u"
        + id
        + "\",\"name\":\"n\",\"kind\":\""
        + kind
        + "\"}";
  }

  private void assigneesChanged(
      long issueId, long actor, String added, String removed, OffsetDateTime at) {
    String payload =
        "{\"added\":["
            + (added == null ? "" : added)
            + "],\"removed\":["
            + (removed == null ? "" : removed)
            + "]}";
    historyRepository.insert(issueId, actor, "ASSIGNEES_CHANGED", null, payload, at);
  }

  /** 착수해 끝난 작업 — startedAt 에 WORKING, 한 시간 뒤 COMPLETED 이벤트(저장소가 남기는 모양). */
  private void agentWork(long issueId, long agentId, OffsetDateTime startedAt) {
    agentWorkWithEvents(
        issueId,
        agentId,
        List.of("WORKING", "COMPLETED"),
        List.of(startedAt, startedAt.plusHours(1)));
  }

  /** 작업 행 하나와 상태 변경 이벤트(시각 지정)를 넣는다. states 와 times 는 같은 순서·길이. 행의 최종 상태는 마지막 이벤트. */
  private void agentWorkWithEvents(
      long issueId, long agentId, List<String> states, List<OffsetDateTime> times) {
    String last = states.get(states.size() - 1);
    Long workId =
        dsl.insertInto(AGENT_WORK)
            .set(AGENT_WORK.ISSUE_ID, issueId)
            .set(AGENT_WORK.WORKER_ID, agentId)
            .set(AGENT_WORK.STATE, last)
            .set(AGENT_WORK.STARTED_AT, times.get(0))
            .set(AGENT_WORK.ENDED_AT, times.get(times.size() - 1))
            .returning(AGENT_WORK.ID)
            .fetchOne()
            .getId();
    for (int i = 0; i < states.size(); i++) {
      dsl.insertInto(AGENT_WORK_EVENT)
          .set(AGENT_WORK_EVENT.WORK_ID, workId)
          .set(AGENT_WORK_EVENT.STATE, states.get(i))
          .set(AGENT_WORK_EVENT.CREATED_AT, times.get(i))
          .execute();
    }
  }

  private ClosedIssueFact factOf(IssueMetrics m, long issueId) {
    return m.closedIssues().stream().filter(f -> f.issueId() == issueId).findFirst().orElseThrow();
  }

  // 1
  @Test
  void canceled_issue_is_not_completed_but_counts_as_created() {
    Long owner = user("mt");
    var p = project(owner, "TEAM");
    long canceled = issue(owner, p, t("2026-11-04T01:00:00Z"));
    close(canceled, "CANCELED", t("2026-11-05T01:00:00Z"), LocalDate.of(2026, 11, 1));

    var m = metricsService.forProject(owner, p.key(), WEEK, MetricsGranularity.DAY);
    assertThat(m.current().completed()).isZero();
    assertThat(m.current().overdue()).isZero();
    assertThat(m.current().leadTimeDaysAvg()).isNull();
    assertThat(m.closedIssues()).isEmpty();
    assertThat(m.current().created()).isEqualTo(1);
  }

  // 2
  @Test
  void due_date_changed_after_close_keeps_on_time() {
    Long owner = user("mt");
    var p = project(owner, "TEAM");
    long id = issue(owner, p, t("2026-11-01T01:00:00Z"));
    historyRepository.insert(
        id, owner, "DUE_DATE_CHANGED", null, "2026-11-10", t("2026-11-01T02:00:00Z"));
    close(id, "DONE", t("2026-11-09T03:00:00Z"), LocalDate.of(2026, 11, 5));
    historyRepository.insert(
        id, owner, "DUE_DATE_CHANGED", "2026-11-10", "2026-11-05", t("2026-11-10T03:00:00Z"));

    var f = factOf(metricsService.forProject(owner, p.key(), WEEK, MetricsGranularity.DAY), id);
    assertThat(f.dueAtClose()).isEqualTo(LocalDate.of(2026, 11, 10));
    assertThat(f.outcome()).isEqualTo(DueOutcome.ON_TIME);
  }

  @Test
  void due_cleared_before_close_means_no_due() {
    Long owner = user("mt");
    var p = project(owner, "TEAM");
    long id = issue(owner, p, t("2026-11-01T01:00:00Z"));
    historyRepository.insert(
        id, owner, "DUE_DATE_CHANGED", "2026-11-04", null, t("2026-11-02T01:00:00Z"));
    // 닫힌 뒤 다시 마감을 넣어 현재 값은 있다 — 그래도 닫힐 당시는 마감 없음
    close(id, "DONE", t("2026-11-06T01:00:00Z"), LocalDate.of(2026, 11, 1));
    historyRepository.insert(
        id, owner, "DUE_DATE_CHANGED", null, "2026-11-01", t("2026-11-07T01:00:00Z"));

    var f = factOf(metricsService.forProject(owner, p.key(), WEEK, MetricsGranularity.DAY), id);
    assertThat(f.outcome()).isEqualTo(DueOutcome.NO_DUE);
  }

  // 3
  @Test
  void reopened_then_closed_counts_once_and_open_issue_counts_zero() {
    Long owner = user("mt");
    var p = project(owner, "TEAM");
    long reclosed = issue(owner, p, t("2026-10-20T01:00:00Z"));
    // 지난 기간에 한 번 닫혔다가 다시 열려 이번 기간에 다시 닫힘 → closed_at 은 마지막 닫힘
    close(reclosed, "DONE", t("2026-11-06T01:00:00Z"), null);
    long reopened = issue(owner, p, t("2026-10-20T01:00:00Z"));
    close(reopened, "IN_PROGRESS", null, null);

    var m = metricsService.forProject(owner, p.key(), WEEK, MetricsGranularity.DAY);
    assertThat(m.current().completed()).isEqualTo(1);
    assertThat(m.previous().completed()).isZero();
    assertThat(m.closedIssues()).extracting(ClosedIssueFact::issueId).containsExactly(reclosed);
  }

  // 4
  @Test
  void person_scope_uses_assignee_at_close() {
    Long a = user("ma");
    Long b = user("mb");
    Long c = user("mc");
    var p = project(a, "OPEN");
    long id = issue(a, p, t("2026-11-03T01:00:00Z"));
    // 실제 기록기(IssueHistoryRecorder)로 남긴다 — B 는 닫힌 뒤 빠져 지금 담당자가 아니라 이력 LIKE 로만 후보가 되므로, 앱이 실제로 쓰는
    // payload 모양(active 같은 여분 필드 포함)에서 후보 조건이 맞는지 고정한다.
    var ua = new UserSummary(a, "ua", "A", "HUMAN", true);
    var ub = new UserSummary(b, "ub", "B", "HUMAN", true);
    var uc = new UserSummary(c, "uc", "C", "HUMAN");
    historyRecorder.recordAssigneesChanged(
        a, id, List.of(ua), List.of(), t("2026-11-03T02:00:00Z"));
    historyRecorder.recordAssigneesChanged(
        a, id, List.of(ub), List.of(ua), t("2026-11-05T02:00:00Z"));
    close(id, "DONE", t("2026-11-08T02:00:00Z"), null);
    // 닫힌 뒤 C 로 바뀜 — 현재 담당자는 C
    historyRecorder.recordAssigneesChanged(
        a, id, List.of(uc), List.of(ub), t("2026-11-10T02:00:00Z"));
    assign(id, c, a);

    assertThat(metricsService.forMe(b, WEEK, MetricsGranularity.DAY).current().completed())
        .isEqualTo(1);
    assertThat(metricsService.forMe(a, WEEK, MetricsGranularity.DAY).current().completed())
        .isZero();
    assertThat(metricsService.forMe(c, WEEK, MetricsGranularity.DAY).current().completed())
        .isZero();
    // 새로 생김은 보고자(A) 기준
    assertThat(metricsService.forMe(a, WEEK, MetricsGranularity.DAY).current().created())
        .isEqualTo(1);
    assertThat(metricsService.forMe(b, WEEK, MetricsGranularity.DAY).current().created()).isZero();
  }

  @Test
  void person_scope_counts_multi_assignee_issue_once_without_history() {
    Long a = user("ma");
    Long b = user("mb");
    var p = project(a, "OPEN");
    long id = issue(a, p, t("2026-11-01T01:00:00Z"));
    assign(id, a, a);
    assign(id, b, a);
    close(id, "DONE", t("2026-11-04T01:00:00Z"), null);

    var mine = metricsService.forMe(a, WEEK, MetricsGranularity.DAY);
    assertThat(mine.current().completed()).isEqualTo(1);
    assertThat(mine.closedIssues()).hasSize(1);
  }

  // 5
  @Test
  void seoul_midnight_boundary_buckets() {
    Long owner = user("mt");
    var p = project(owner, "TEAM");
    long midnight = issue(owner, p, t("2026-11-01T01:00:00Z"));
    close(midnight, "DONE", t("2026-11-09T15:00:00Z"), null); // = 11-10 00:00 KST
    long justBefore = issue(owner, p, t("2026-11-01T01:00:00Z"));
    close(justBefore, "DONE", t("2026-11-09T14:59:59Z"), null); // = 11-09 23:59:59 KST

    var period = new MetricsPeriod(LocalDate.of(2026, 11, 4), LocalDate.of(2026, 11, 10));
    var m = metricsService.forProject(owner, p.key(), period, MetricsGranularity.DAY);
    assertThat(factOf(m, midnight).closedDate()).isEqualTo(LocalDate.of(2026, 11, 10));
    assertThat(factOf(m, justBefore).closedDate()).isEqualTo(LocalDate.of(2026, 11, 9));
    assertThat(m.buckets().get(5).completed()).isEqualTo(1); // 11-09
    assertThat(m.buckets().get(6).completed()).isEqualTo(1); // 11-10
    // 기간이 11-09 에 끝나면 자정 건은 빠진다
    var cut = metricsService.forProject(owner, p.key(), WEEK, MetricsGranularity.DAY);
    assertThat(cut.closedIssues()).extracting(ClosedIssueFact::issueId).containsExactly(justBefore);
  }

  // 6
  @Test
  void empty_buckets_are_zero_filled_for_day_week_month() {
    Long owner = user("mt");
    var p = project(owner, "TEAM");
    long id = issue(owner, p, t("2026-10-01T01:00:00Z"));
    close(id, "DONE", t("2026-11-05T03:00:00Z"), null);

    var day = metricsService.forProject(owner, p.key(), WEEK, MetricsGranularity.DAY);
    assertThat(day.buckets()).hasSize(7);
    assertThat(day.buckets())
        .extracting(MetricsBucket::completed)
        .containsExactly(0, 0, 1, 0, 0, 0, 0);

    var week = metricsService.forProject(owner, p.key(), WEEK, MetricsGranularity.WEEK);
    // 11-03(화)~11-08(일), 11-09(월)~11-09
    assertThat(week.buckets())
        .extracting(MetricsBucket::start, MetricsBucket::end, MetricsBucket::completed)
        .containsExactly(
            org.assertj.core.groups.Tuple.tuple(
                LocalDate.of(2026, 11, 3), LocalDate.of(2026, 11, 8), 1),
            org.assertj.core.groups.Tuple.tuple(
                LocalDate.of(2026, 11, 9), LocalDate.of(2026, 11, 9), 0));

    var months = new MetricsPeriod(LocalDate.of(2026, 10, 20), LocalDate.of(2026, 11, 30));
    var month = metricsService.forProject(owner, p.key(), months, MetricsGranularity.MONTH);
    assertThat(month.buckets())
        .extracting(MetricsBucket::start, MetricsBucket::end, MetricsBucket::completed)
        .containsExactly(
            org.assertj.core.groups.Tuple.tuple(
                LocalDate.of(2026, 10, 20), LocalDate.of(2026, 10, 31), 0),
            org.assertj.core.groups.Tuple.tuple(
                LocalDate.of(2026, 11, 1), LocalDate.of(2026, 11, 30), 1));
  }

  // 7
  @Test
  void with_ai_cases() {
    Long owner = user("mt");
    long agent = TestFixtures.createAgentNoToken(dsl);
    var p = project(owner, "TEAM");
    OffsetDateTime closedAt = t("2026-11-06T03:00:00Z");

    long none = issue(owner, p, t("2026-11-01T01:00:00Z"));
    assign(none, owner, owner);
    close(none, "DONE", closedAt, null);

    long a = issue(owner, p, t("2026-11-01T01:00:00Z"));
    assign(a, agent, owner);
    close(a, "DONE", closedAt, null);

    long b = issue(owner, p, t("2026-11-01T01:00:00Z"));
    assigneesChanged(b, owner, person(agent, "AGENT"), null, t("2026-11-02T01:00:00Z"));
    assigneesChanged(b, owner, null, person(agent, "AGENT"), t("2026-11-03T01:00:00Z"));
    close(b, "DONE", closedAt, null);

    long c = issue(owner, p, t("2026-11-01T01:00:00Z"));
    agentWork(c, agent, t("2026-11-05T01:00:00Z"));
    close(c, "DONE", closedAt, null);

    long late = issue(owner, p, t("2026-11-01T01:00:00Z"));
    agentWork(late, agent, t("2026-11-07T01:00:00Z"));
    close(late, "DONE", closedAt, null);

    var m = metricsService.forProject(owner, p.key(), WEEK, MetricsGranularity.DAY);
    assertThat(factOf(m, none).withAi()).isFalse();
    assertThat(factOf(m, a).withAi()).isTrue();
    assertThat(factOf(m, b).withAi()).isTrue();
    assertThat(factOf(m, c).withAi()).isTrue();
    assertThat(factOf(m, late).withAi()).isFalse();
    assertThat(m.current().completedWithAi()).isEqualTo(3);
  }

  @Test
  void kind_comes_from_user_table_and_broken_payload_is_skipped() {
    Long owner = user("mt");
    long agent = TestFixtures.createAgentNoToken(dsl);
    var p = project(owner, "TEAM");
    long id = issue(owner, p, t("2026-11-01T01:00:00Z"));
    historyRepository.insert(
        id, owner, "ASSIGNEES_CHANGED", null, "{not json", t("2026-11-02T00:00:00Z"));
    historyRepository.insert(
        id,
        owner,
        "ASSIGNEES_CHANGED",
        null,
        "{\"added\":[{\"id\":" + agent + "}],\"removed\":[]}",
        t("2026-11-02T01:00:00Z"));
    close(id, "DONE", t("2026-11-04T01:00:00Z"), null);

    var f = factOf(metricsService.forProject(owner, p.key(), WEEK, MetricsGranularity.DAY), id);
    assertThat(f.withAi()).isTrue();
  }

  @Test
  void with_ai_ignores_agent_work_that_never_ran() {
    Long owner = user("mt");
    long agent = TestFixtures.createAgentNoToken(dsl);
    var p = project(owner, "TEAM");
    OffsetDateTime closedAt = t("2026-11-06T03:00:00Z");

    // 배정으로 SUBMITTED 가 생겼다가 착수 없이 취소 — started_at 은 닫히기 전이지만 AI와 함께가 아니다
    long neverRan = issue(owner, p, t("2026-11-01T01:00:00Z"));
    agentWorkWithEvents(
        neverRan,
        agent,
        List.of("SUBMITTED", "CANCELED"),
        List.of(t("2026-11-02T01:00:00Z"), t("2026-11-06T03:00:00Z")));
    close(neverRan, "DONE", closedAt, null);

    // SUBMITTED 였다가 닫히기 전에 WORKING — AI와 함께
    long ran = issue(owner, p, t("2026-11-01T01:00:00Z"));
    agentWorkWithEvents(
        ran,
        agent,
        List.of("SUBMITTED", "WORKING", "COMPLETED"),
        List.of(t("2026-11-02T01:00:00Z"), t("2026-11-04T01:00:00Z"), t("2026-11-05T01:00:00Z")));
    close(ran, "DONE", closedAt, null);

    // 닫히기 전엔 SUBMITTED 뿐, 닫힌 뒤에야 WORKING — AI와 함께가 아니다
    long ranAfter = issue(owner, p, t("2026-11-01T01:00:00Z"));
    agentWorkWithEvents(
        ranAfter,
        agent,
        List.of("SUBMITTED", "WORKING", "COMPLETED"),
        List.of(t("2026-11-02T01:00:00Z"), t("2026-11-07T01:00:00Z"), t("2026-11-07T02:00:00Z")));
    close(ranAfter, "DONE", closedAt, null);

    var m = metricsService.forProject(owner, p.key(), WEEK, MetricsGranularity.DAY);
    assertThat(factOf(m, neverRan).withAi()).isFalse();
    assertThat(factOf(m, ran).withAi()).isTrue();
    assertThat(factOf(m, ranAfter).withAi()).isFalse();
  }

  @Test
  void with_ai_real_writer_submitted_then_canceled_on_done_is_not_ai() {
    // 실제 저장소 경로(배정 → SUBMITTED, 이슈 완료 → 착수 전이라 CANCELED)로 이벤트를 남긴다. 이벤트 시각은 DB now() 라 닫힌 시각을 그 뒤로
    // 둔다.
    Long owner = user("mt");
    long agent = TestFixtures.createAgentNoToken(dsl);
    var p = project(owner, "TEAM");
    LocalDate today = LocalDate.now(IssueDueWindow.ZONE);
    long id = issue(owner, p, OffsetDateTime.now().minusDays(1));
    agentWorkRepository.insertSubmitted(id, List.of(agent));
    agentWorkRepository.endActiveOnIssueDone(List.of(id));
    close(id, "DONE", OffsetDateTime.now().plusHours(1), null);

    var period = new MetricsPeriod(today.minusDays(1), today.plusDays(1));
    var f = factOf(metricsService.forProject(owner, p.key(), period, MetricsGranularity.DAY), id);
    assertThat(f.withAi()).isFalse();
  }

  @Test
  void with_ai_counts_agent_removed_before_close_without_add_history() {
    // 만들 때 AI 를 담당으로 넣으면 추가 이력이 없다 — 닫히기 전 빠진 기록(removed)만으로 AI와 함께
    Long owner = user("mt");
    long agent = TestFixtures.createAgentNoToken(dsl);
    var p = project(owner, "TEAM");
    long id = issue(owner, p, t("2026-11-01T01:00:00Z"));
    assigneesChanged(id, owner, null, person(agent, "AGENT"), t("2026-11-03T01:00:00Z"));
    close(id, "DONE", t("2026-11-06T03:00:00Z"), null);

    var f = factOf(metricsService.forProject(owner, p.key(), WEEK, MetricsGranularity.DAY), id);
    assertThat(f.withAi()).isTrue();
  }

  @Test
  void negative_lead_time_is_excluded_from_average() {
    Long owner = user("mt");
    var p = project(owner, "TEAM");
    long bad = issue(owner, p, t("2026-11-05T00:00:00Z"));
    close(bad, "DONE", t("2026-11-04T00:00:00Z"), null); // 닫힘이 생성보다 앞섬(잘못 가져온 데이터)
    long good = issue(owner, p, t("2026-11-04T00:00:00Z"));
    close(good, "DONE", t("2026-11-07T00:00:00Z"), null);

    var m = metricsService.forProject(owner, p.key(), WEEK, MetricsGranularity.DAY);
    assertThat(m.current().completed()).isEqualTo(2);
    assertThat(factOf(m, bad).leadTimeDays()).isNull();
    assertThat(m.current().leadTimeDaysAvg()).isEqualTo(3.0);
    assertThat(m.current().leadTimeDaysMedian()).isEqualTo(3.0);
  }

  @Test
  void person_scope_finds_history_payload_with_whitespace() {
    // 공백이 낀 payload(직접 넣은 옛 데이터 등)도 후보 정규식이 찾는다 — B 는 닫힌 뒤 빠져 지금 담당자가 아니다
    Long a = user("ma");
    Long b = user("mb");
    var p = project(a, "OPEN");
    long id = issue(a, p, t("2026-11-03T01:00:00Z"));
    String spaced = "{ \"id\" : " + b + " , \"kind\" : \"HUMAN\" }";
    historyRepository.insert(
        id,
        a,
        "ASSIGNEES_CHANGED",
        null,
        "{\"added\": [" + spaced + "], \"removed\": []}",
        t("2026-11-03T02:00:00Z"));
    close(id, "DONE", t("2026-11-05T02:00:00Z"), null);
    historyRepository.insert(
        id,
        a,
        "ASSIGNEES_CHANGED",
        null,
        "{\"added\": [], \"removed\": [" + spaced + "]}",
        t("2026-11-06T02:00:00Z"));

    assertThat(metricsService.forMe(b, WEEK, MetricsGranularity.DAY).current().completed())
        .isEqualTo(1);
  }

  @Test
  void payload_kind_is_ignored_in_favor_of_user_kind() {
    // payload 에 HUMAN 이라 적혀 있어도 그 사람이 AI 구성원이면 AI와 함께 — 종류는 사람의 속성이다
    Long owner = user("mt");
    long agent = TestFixtures.createAgentNoToken(dsl);
    var p = project(owner, "TEAM");
    long id = issue(owner, p, t("2026-11-01T01:00:00Z"));
    assigneesChanged(id, owner, person(agent, "HUMAN"), null, t("2026-11-02T01:00:00Z"));
    assigneesChanged(id, owner, null, person(agent, "HUMAN"), t("2026-11-03T01:00:00Z"));
    close(id, "DONE", t("2026-11-05T01:00:00Z"), null);

    var f = factOf(metricsService.forProject(owner, p.key(), WEEK, MetricsGranularity.DAY), id);
    assertThat(f.withAi()).isTrue();
  }

  // 8
  @Test
  void permissions_project_and_person_scope() {
    Long owner = user("mt");
    Long outsider = user("mo");
    var team = project(owner, "TEAM");
    long id = issue(owner, team, t("2026-11-01T01:00:00Z"));
    // 멤버가 아닌 사람이 담당자로 남아 있어도 읽을 수 없는 TEAM 프로젝트 이슈는 그 사람 지표에 섞이지 않는다
    assign(id, outsider, owner);
    close(id, "DONE", t("2026-11-04T01:00:00Z"), null);

    assertThatThrownBy(
            () -> metricsService.forProject(outsider, team.key(), WEEK, MetricsGranularity.DAY))
        .isInstanceOf(ProjectNotFoundException.class);
    assertThat(metricsService.forMe(outsider, WEEK, MetricsGranularity.DAY).current().completed())
        .isZero();
    // 본인(owner)은 담당이 아니므로 0, 프로젝트 기준은 1
    assertThat(metricsService.forMe(owner, WEEK, MetricsGranularity.DAY).current().completed())
        .isZero();
    assertThat(
            metricsService
                .forProject(owner, team.key(), WEEK, MetricsGranularity.DAY)
                .current()
                .completed())
        .isEqualTo(1);
  }

  @Test
  void deleted_issue_and_deleted_project_are_excluded() {
    Long owner = user("mt");
    var p = project(owner, "OPEN");
    long deleted = issue(owner, p, t("2026-11-04T01:00:00Z"));
    assign(deleted, owner, owner);
    close(deleted, "DONE", t("2026-11-05T01:00:00Z"), null);
    dsl.update(ISSUE)
        .set(ISSUE.DELETED_AT, OffsetDateTime.now())
        .where(ISSUE.ID.eq(deleted))
        .execute();

    var gone = project(owner, "OPEN");
    long inGone = issue(owner, gone, t("2026-11-04T01:00:00Z"));
    assign(inGone, owner, owner);
    close(inGone, "DONE", t("2026-11-05T01:00:00Z"), null);
    dsl.update(PROJECT)
        .set(PROJECT.DELETED_AT, OffsetDateTime.now())
        .where(PROJECT.ID.eq(gone.id()))
        .execute();

    var mine = metricsService.forMe(owner, WEEK, MetricsGranularity.DAY);
    assertThat(mine.current().completed()).isZero();
    assertThat(mine.current().created()).isZero();
    var proj = metricsService.forProject(owner, p.key(), WEEK, MetricsGranularity.DAY);
    assertThat(proj.current().completed()).isZero();
    assertThat(proj.current().created()).isZero();
  }

  // 9
  @Test
  void previous_period_lead_time_and_late_days() {
    Long owner = user("mt");
    var p = project(owner, "TEAM");
    // 현재 기간: 소요 1일·2일·4일(평균 7/3, 중간값 2), 초과 2건(2일·4일 늦음), 기한 내 1건
    long i1 = issue(owner, p, t("2026-11-03T00:00:00Z"));
    close(i1, "DONE", t("2026-11-04T00:00:00Z"), LocalDate.of(2026, 11, 4));
    long i2 = issue(owner, p, t("2026-11-04T00:00:00Z"));
    close(i2, "DONE", t("2026-11-06T00:00:00Z"), LocalDate.of(2026, 11, 4));
    long i3 = issue(owner, p, t("2026-11-04T00:00:00Z"));
    close(i3, "DONE", t("2026-11-08T00:00:00Z"), LocalDate.of(2026, 11, 4));
    // 지난 기간: 1건, 마감 없음
    long old = issue(owner, p, t("2026-10-25T00:00:00Z"));
    close(old, "DONE", t("2026-10-30T00:00:00Z"), null);

    var m = metricsService.forProject(owner, p.key(), WEEK, MetricsGranularity.DAY);
    assertThat(m.previousPeriod())
        .isEqualTo(new MetricsPeriod(LocalDate.of(2026, 10, 27), LocalDate.of(2026, 11, 2)));
    assertThat(m.current().completed()).isEqualTo(3);
    assertThat(m.current().created()).isEqualTo(3);
    assertThat(m.current().leadTimeDaysAvg()).isCloseTo(7.0 / 3, within(1e-9));
    assertThat(m.current().leadTimeDaysMedian()).isEqualTo(2.0);
    assertThat(m.current().onTime()).isEqualTo(1);
    assertThat(m.current().overdue()).isEqualTo(2);
    assertThat(m.current().overdueLateDaysAvg()).isEqualTo(3.0);
    assertThat(m.current().onTimeRate()).isCloseTo(1.0 / 3, within(1e-9));
    assertThat(m.previous().completed()).isEqualTo(1);
    assertThat(m.previous().noDue()).isEqualTo(1);
    assertThat(m.previous().leadTimeDaysAvg()).isEqualTo(5.0);
    // 지난 기간 생성(10-25)은 지난 기간 범위(10-27~) 밖이라 0
    assertThat(m.previous().created()).isZero();
    // 닫힌 시각 내림차순
    assertThat(m.closedIssues()).extracting(ClosedIssueFact::issueId).containsExactly(i3, i2, i1);
    assertThat(factOf(m, i3).lateDays()).isEqualTo(4);
  }
}
