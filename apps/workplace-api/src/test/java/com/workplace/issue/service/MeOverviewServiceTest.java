package com.workplace.issue.service;

import static com.workplace.jooq.Tables.AGENT_WORK;
import static com.workplace.jooq.Tables.AGENT_WORK_EVENT;
import static com.workplace.jooq.Tables.ISSUE;
import static com.workplace.jooq.Tables.ISSUE_ASSIGNEE;
import static com.workplace.jooq.Tables.ISSUE_COMMENT;
import static com.workplace.jooq.Tables.PROJECT;
import static com.workplace.jooq.Tables.ROLE;
import static com.workplace.jooq.Tables.USER;
import static com.workplace.jooq.Tables.USER_ROLE;
import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.workplace.global.security.JwtTokenProvider;
import com.workplace.issue.dto.CreateIssueRequest;
import com.workplace.issue.dto.MeDaySummary;
import com.workplace.issue.dto.MeOverviewPeriod;
import com.workplace.issue.dto.MeOverviewResponse;
import com.workplace.issue.dto.MeOverviewResponse.UpcomingItem;
import com.workplace.issue.metrics.DueOutcome;
import com.workplace.issue.metrics.MetricsGranularity;
import com.workplace.issue.repository.MeOverviewRepository;
import com.workplace.project.dto.AddMemberRequest;
import com.workplace.project.dto.CreateProjectRequest;
import com.workplace.project.dto.ProjectResponse;
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
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.transaction.annotation.Transactional;

/**
 * WP-1484 — 「내 작업 · 개요」 API 통합 테스트. 본인만(다른 사람 지표를 볼 길 없음), 기간 경계(이번 주/이번 달/최근 3개월), 어제/오늘(서울 자정
 * 경계), 나를 기다림, 앞으로 할 일 타일, 끝낸 일 표시 정보를 고정한다.
 *
 * <p>「지금」은 서비스의 시각을 받는 판(같은 패키지)으로 넘긴다 — 싱글턴 빈의 시계를 바꾸지 않게. 이슈는 담당자·마감 없이 만들고 상태·시각은 직접 갱신한다(지표 모듈
 * 테스트와 같은 방식).
 */
@Transactional
class MeOverviewServiceTest extends IntegrationTestBase {

  @Autowired DSLContext dsl;
  @Autowired IssueService issueService;
  @Autowired ProjectService projectService;
  @Autowired MeOverviewService service;
  @Autowired MeOverviewRepository repository;
  @Autowired MockMvc mvc;
  @Autowired JwtTokenProvider jwtTokenProvider;

  private static OffsetDateTime t(String iso) {
    return OffsetDateTime.parse(iso);
  }

  private static LocalDate d(String iso) {
    return LocalDate.parse(iso);
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

  /** 다른 사람을 프로젝트 멤버로 — 그 사람도 이 프로젝트를 읽을 수 있어야 「자기 개요」에 보인다. */
  private void member(ProjectResponse p, Long ownerId, Long userId) {
    withMembership(userId);
    projectService.addMember(ownerId, p.key(), new AddMemberRequest(userId, "MEMBER"));
  }

  private ProjectResponse project(Long ownerId) {
    String suffix = UUID.randomUUID().toString().replaceAll("-", "").toUpperCase().substring(0, 4);
    return projectService.create(
        ownerId, new CreateProjectRequest("MO" + suffix, "P-MO" + suffix, "x", "TEAM"));
  }

  /** 담당자·마감 없는 열린 이슈를 만들고 생성 시각을 정한다. */
  private long issue(Long reporter, ProjectResponse p, String title, OffsetDateTime createdAt) {
    var created =
        issueService.create(
            reporter,
            p.key(),
            new CreateIssueRequest(title, null, null, null, null, null, null, null));
    dsl.deleteFrom(ISSUE_ASSIGNEE).where(ISSUE_ASSIGNEE.ISSUE_ID.eq(created.id())).execute();
    dsl.update(ISSUE).set(ISSUE.CREATED_AT, createdAt).where(ISSUE.ID.eq(created.id())).execute();
    return created.id();
  }

  private void due(long issueId, LocalDate due) {
    dsl.update(ISSUE).set(ISSUE.DUE_DATE, due).where(ISSUE.ID.eq(issueId)).execute();
  }

  /** DONE 으로 닫고 닫힌 시각·마감일을 정한다. */
  private void close(long issueId, OffsetDateTime closedAt, LocalDate due) {
    dsl.update(ISSUE)
        .set(ISSUE.STATUS, "DONE")
        .set(ISSUE.STATUS_ID, TestFixtures.defaultStatusId(ISSUE.PROJECT_ID, "DONE"))
        .set(ISSUE.CLOSED_AT, closedAt)
        .set(ISSUE.DUE_DATE, due)
        .where(ISSUE.ID.eq(issueId))
        .execute();
  }

  private void assign(long issueId, long userId) {
    dsl.insertInto(ISSUE_ASSIGNEE)
        .set(ISSUE_ASSIGNEE.ISSUE_ID, issueId)
        .set(ISSUE_ASSIGNEE.USER_ID, userId)
        .set(ISSUE_ASSIGNEE.ASSIGNED_BY, userId)
        .execute();
  }

  /**
   * AI 작업 행 하나 — state 이벤트를 at 에 남긴다. ended 면 한 시간 뒤 끝난 작업(행 상태는 종료 상태여야 해서 CANCELED, 그 이벤트도 남긴다),
   * 아니면 state 로 진행 중.
   */
  private void agentWork(
      long issueId, long agentId, String state, OffsetDateTime at, boolean ended) {
    Long workId =
        dsl.insertInto(AGENT_WORK)
            .set(AGENT_WORK.ISSUE_ID, issueId)
            .set(AGENT_WORK.WORKER_ID, agentId)
            .set(AGENT_WORK.STATE, ended ? "CANCELED" : state)
            .set(AGENT_WORK.STARTED_AT, at)
            .set(AGENT_WORK.STATE_CHANGED_AT, at)
            .set(AGENT_WORK.ENDED_AT, ended ? at.plusHours(1) : null)
            .returning(AGENT_WORK.ID)
            .fetchOne()
            .getId();
    dsl.insertInto(AGENT_WORK_EVENT)
        .set(AGENT_WORK_EVENT.WORK_ID, workId)
        .set(AGENT_WORK_EVENT.STATE, state)
        .set(AGENT_WORK_EVENT.CREATED_AT, at)
        .execute();
    if (ended) {
      dsl.insertInto(AGENT_WORK_EVENT)
          .set(AGENT_WORK_EVENT.WORK_ID, workId)
          .set(AGENT_WORK_EVENT.STATE, "CANCELED")
          .set(AGENT_WORK_EVENT.CREATED_AT, at.plusHours(1))
          .execute();
    }
  }

  private void comment(long issueId, long authorId, String body, OffsetDateTime at) {
    dsl.insertInto(ISSUE_COMMENT)
        .set(ISSUE_COMMENT.ISSUE_ID, issueId)
        .set(ISSUE_COMMENT.AUTHOR_ID, authorId)
        .set(ISSUE_COMMENT.BODY, body)
        .set(ISSUE_COMMENT.CREATED_AT, at)
        .set(ISSUE_COMMENT.UPDATED_AT, at)
        .execute();
  }

  private String tokenFor(long userId) {
    return jwtTokenProvider.generateAccessToken(userId, "user-" + userId);
  }

  @Test
  void endpoint_returns_only_callers_own_overview_even_with_foreign_user_param() throws Exception {
    Long me = user("mo-me");
    Long other = user("mo-other");
    var p = project(me);
    member(p, me, other);
    // 다른 사람이 담당인 열린 이슈 — 내 개요에 섞이면 안 된다.
    long theirs = issue(me, p, "남의 일", t("2026-01-01T00:00:00Z"));
    assign(theirs, other);
    due(theirs, d("2020-01-01"));

    mvc.perform(
            get("/api/v1/me/overview")
                .param("userId", String.valueOf(other))
                .header("Authorization", "Bearer " + tokenFor(me)))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.period").value("MONTH"))
        .andExpect(jsonPath("$.granularity").value("DAY"))
        .andExpect(jsonPath("$.upcoming.openAssigned").value(0))
        .andExpect(jsonPath("$.day.overdue").value(0));

    // 같은 데이터를 그 사람 자신이 보면 자기 것으로 보인다.
    mvc.perform(
            get("/api/v1/me/overview/today").header("Authorization", "Bearer " + tokenFor(other)))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.overdue").value(1));
  }

  @Test
  void endpoint_rejects_unknown_period_and_requires_login() throws Exception {
    Long me = user("mo-me");
    mvc.perform(
            get("/api/v1/me/overview")
                .param("period", "YEAR")
                .header("Authorization", "Bearer " + tokenFor(me)))
        .andExpect(status().isBadRequest());
    mvc.perform(get("/api/v1/me/overview")).andExpect(status().isUnauthorized());
  }

  @Test
  void period_boundaries_week_month_quarter() {
    Long me = user("mo-me");
    var p = project(me);
    // 지금 = 2026-11-11(수) 12:00 KST.
    OffsetDateTime now = t("2026-11-11T03:00:00Z");
    // 11-08(일) 23:30 KST 에 닫힘 — 이번 달엔 들지만 이번 주(11-09 월~)엔 안 든다.
    long sunday = issue(me, p, "일요일", t("2026-11-01T00:00:00Z"));
    assign(sunday, me);
    close(sunday, t("2026-11-08T14:30:00Z"), null);
    // 11-09(월) 00:30 KST 에 닫힘 — 이번 주 첫날.
    long monday = issue(me, p, "월요일", t("2026-11-01T00:00:00Z"));
    assign(monday, me);
    close(monday, t("2026-11-08T15:30:00Z"), null);
    // 08-14 00:10 KST — 최근 3개월(오늘 포함 90일)의 첫날. 08-13 은 지난 기간.
    long first = issue(me, p, "90일 첫날", t("2026-08-01T00:00:00Z"));
    assign(first, me);
    close(first, t("2026-08-13T15:10:00Z"), null);
    long before = issue(me, p, "90일 전날", t("2026-08-01T00:00:00Z"));
    assign(before, me);
    close(before, t("2026-08-13T14:50:00Z"), null);

    var week = service.overview(me, MeOverviewPeriod.WEEK, MetricsGranularity.DAY, now);
    assertThat(week.from()).isEqualTo(d("2026-11-09"));
    assertThat(week.to()).isEqualTo(d("2026-11-11"));
    assertThat(week.previousFrom()).isEqualTo(d("2026-11-06"));
    assertThat(week.buckets()).hasSize(3);
    assertThat(week.closed())
        .extracting(MeOverviewResponse.ClosedItem::issueId)
        .containsExactly(monday);
    assertThat(week.previous().completed()).isEqualTo(1); // 일요일 건이 지난 기간(11-06~11-08)

    var month = service.overview(me, MeOverviewPeriod.MONTH, MetricsGranularity.DAY, now);
    assertThat(month.from()).isEqualTo(d("2026-11-01"));
    assertThat(month.current().completed()).isEqualTo(2);
    // 닫힌 시각 내림차순.
    assertThat(month.closed())
        .extracting(MeOverviewResponse.ClosedItem::issueId)
        .containsExactly(monday, sunday);

    var quarter = service.overview(me, MeOverviewPeriod.QUARTER, MetricsGranularity.WEEK, now);
    assertThat(quarter.from()).isEqualTo(d("2026-08-14"));
    assertThat(quarter.to()).isEqualTo(d("2026-11-11"));
    assertThat(quarter.current().completed()).isEqualTo(3);
    assertThat(quarter.previous().completed()).isEqualTo(1);
    // 주별 추이여도 날짜 줄용 일별 합계는 하루 단위(90칸)로 온다.
    assertThat(quarter.dailyTotals()).hasSize(90);
    assertThat(quarter.buckets().size()).isLessThan(20);
  }

  @Test
  void yesterday_and_today_follow_seoul_midnight() {
    Long me = user("mo-me");
    var p = project(me);
    // 11-10 23:59 KST 에 닫힘(11-10 14:59Z).
    long late = issue(me, p, "11-10 밤", t("2026-11-01T00:00:00Z"));
    assign(late, me);
    close(late, t("2026-11-10T14:59:00Z"), d("2026-11-10"));
    // 11-09 23:30 KST 에 닫힘.
    long prevDay = issue(me, p, "11-09 밤", t("2026-11-01T00:00:00Z"));
    assign(prevDay, me);
    close(prevDay, t("2026-11-09T14:30:00Z"), d("2026-11-01"));
    // 11-10 10:00 KST 에 내가 만든 이슈(열림, 담당 없음).
    issue(me, p, "어제 만듦", t("2026-11-10T01:00:00Z"));
    // 열린 담당 이슈 — 마감 11-10, 11-11, 11-05.
    long due10 = issue(me, p, "마감 11-10", t("2026-10-01T00:00:00Z"));
    assign(due10, me);
    due(due10, d("2026-11-10"));
    long due11 = issue(me, p, "마감 11-11", t("2026-10-01T00:00:00Z"));
    assign(due11, me);
    due(due11, d("2026-11-11"));
    long due05 = issue(me, p, "마감 11-05", t("2026-10-01T00:00:00Z"));
    assign(due05, me);
    due(due05, d("2026-11-05"));

    // 11-11 00:00 KST 정각 — 어제 = 11-10, 오늘 = 11-11.
    MeDaySummary atMidnight = service.today(me, t("2026-11-10T15:00:00Z"));
    assertThat(atMidnight.yesterday()).isEqualTo(d("2026-11-10"));
    assertThat(atMidnight.yesterdayCompleted()).isEqualTo(1);
    assertThat(atMidnight.yesterdayCompletedOnTime()).isEqualTo(1);
    assertThat(atMidnight.yesterdayCreated()).isEqualTo(1);
    assertThat(atMidnight.today()).isEqualTo(d("2026-11-11"));
    assertThat(atMidnight.overdue()).isEqualTo(2); // 11-10, 11-05
    assertThat(atMidnight.oldestOverdueDays()).isEqualTo(6); // 11-05 → 11-11
    assertThat(atMidnight.dueToday()).isEqualTo(1); // 11-11

    // 1분 전(11-10 23:59 KST) — 어제 = 11-09, 오늘 = 11-10.
    MeDaySummary justBefore = service.today(me, t("2026-11-10T14:59:00Z"));
    assertThat(justBefore.yesterday()).isEqualTo(d("2026-11-09"));
    assertThat(justBefore.yesterdayCompleted()).isEqualTo(1);
    assertThat(justBefore.yesterdayCompletedOnTime()).isZero(); // 마감 11-01 을 넘겨 닫힘
    assertThat(justBefore.yesterdayCreated()).isZero();
    assertThat(justBefore.overdue()).isEqualTo(1); // 11-05 만
    assertThat(justBefore.dueToday()).isEqualTo(1); // 11-10
  }

  @Test
  void waiting_counts_input_required_on_assigned_or_reported_open_issues() {
    Long me = user("mo-me");
    Long other = user("mo-other");
    Long agent = createAgentUser("mo-ai");
    var p = project(me);
    member(p, me, other);
    OffsetDateTime at = t("2026-11-10T01:00:00Z");
    // ① 내가 보고자(담당은 남) + 답변 필요 진행 중 → 센다.
    long reported = issue(me, p, "보고자", at);
    assign(reported, other);
    agentWork(reported, agent, "INPUT_REQUIRED", at, false);
    // ② 내가 담당 + 답변 필요 진행 중 → 센다.
    long assigned = issue(other, p, "담당", at);
    assign(assigned, me);
    agentWork(assigned, agent, "INPUT_REQUIRED", at.plusHours(1), false);
    // ③ 내가 담당이지만 AI 는 작업 중 → 안 센다.
    long working = issue(other, p, "작업 중", at);
    assign(working, me);
    agentWork(working, agent, "WORKING", at, false);
    // ④ 답변 필요였으나 끝난 작업 → 안 센다.
    long ended = issue(me, p, "끝난 작업", at);
    agentWork(ended, agent, "INPUT_REQUIRED", at, true);
    // ⑤ 나와 무관한 이슈의 답변 필요 → 안 센다.
    long foreign = issue(other, p, "무관", at);
    assign(foreign, other);
    agentWork(foreign, agent, "INPUT_REQUIRED", at, false);
    // ⑥ 내가 담당 + 답변 필요지만 이미 닫힘 → 안 센다.
    long closed = issue(other, p, "닫힘", at);
    assign(closed, me);
    agentWork(closed, agent, "INPUT_REQUIRED", at, false);
    close(closed, at.plusHours(2), null);

    OffsetDateTime now = t("2026-11-11T03:00:00Z");
    assertThat(service.today(me, now).waiting()).isEqualTo(2);
    var u = service.overview(me, MeOverviewPeriod.MONTH, MetricsGranularity.DAY, now).upcoming();
    assertThat(u.waiting()).isEqualTo(2);
    // 오래 기다린 순.
    assertThat(u.waitingTop())
        .extracting(UpcomingItem::issueId)
        .containsExactly(reported, assigned);
    // 맡은 열린 이슈는 담당만(②③) — 보고자로만 걸린 ①은 담당 수에 들지 않는다.
    assertThat(u.openAssigned()).isEqualTo(2);
  }

  @Test
  void upcoming_tiles_count_and_top_three() {
    Long me = user("mo-me");
    Long agent = createAgentUser("mo-ai");
    var p = project(me);
    OffsetDateTime created = t("2026-10-01T00:00:00Z");
    LocalDate today = d("2026-11-11");
    // 기한 지남 넷 — 상위 3건은 마감 오래된 순.
    long[] overdue = new long[4];
    String[] dues = {"2026-11-10", "2026-11-01", "2026-11-05", "2026-10-20"};
    for (int i = 0; i < 4; i++) {
      overdue[i] = issue(me, p, "지남" + i, created);
      assign(overdue[i], me);
      due(overdue[i], d(dues[i]));
    }
    // 마감 임박 — 오늘, 오늘+7(경계 포함). 오늘+8 은 그 밖.
    long soonToday = issue(me, p, "오늘 마감", created);
    assign(soonToday, me);
    due(soonToday, today);
    long soonEdge = issue(me, p, "7일 뒤", created);
    assign(soonEdge, me);
    due(soonEdge, today.plusDays(7));
    assign(soonEdge, agent); // AI 와 함께 담당 — 상위 줄에 AI 이름이 붙는다
    long later = issue(me, p, "8일 뒤", created);
    assign(later, me);
    due(later, today.plusDays(8));
    // 마감 없음 — 그 밖.
    long noDue = issue(me, p, "마감 없음", created);
    assign(noDue, me);

    var u =
        service
            .overview(me, MeOverviewPeriod.MONTH, MetricsGranularity.DAY, t("2026-11-11T03:00:00Z"))
            .upcoming();
    assertThat(u.openAssigned()).isEqualTo(8);
    assertThat(u.overdue()).isEqualTo(4);
    assertThat(u.dueSoon()).isEqualTo(2);
    assertThat(u.waiting()).isZero();
    assertThat(u.other()).isEqualTo(2);
    assertThat(u.overdueTop())
        .extracting(UpcomingItem::issueId)
        .containsExactly(overdue[3], overdue[1], overdue[2]);
    assertThat(u.dueSoonTop())
        .extracting(UpcomingItem::issueId)
        .containsExactly(soonToday, soonEdge);
    assertThat(u.dueSoonTop().get(1).aiNames()).containsExactly("mo-ai");
    assertThat(u.dueSoonTop().get(0).aiNames()).isEmpty();
    // 그 밖은 마감 있는 것 먼저.
    assertThat(u.otherTop()).extracting(UpcomingItem::issueId).containsExactly(later, noDue);
    assertThat(u.overdueTop().get(0).projectKey()).isEqualTo(p.key());
  }

  @Test
  void closed_items_carry_display_ai_names_request_and_last_comment() {
    Long me = user("mo-me");
    Long agent = createAgentUser("mo-ai");
    var p = project(me);
    long id = issue(me, p, "드라이브 복원", t("2026-11-01T00:00:00Z"));
    dsl.update(ISSUE)
        .set(ISSUE.BODY, "**일괄 삭제**한 묶음에서\n\n- 하나만 복원 <@" + me + "> 확인")
        .where(ISSUE.ID.eq(id))
        .execute();
    assign(id, me);
    // AI 가 닫기 전에 실제로 일함 → AI와 함께.
    agentWork(id, agent, "WORKING", t("2026-11-02T00:00:00Z"), true);
    comment(id, me, "첫 코멘트", t("2026-11-03T00:00:00Z"));
    comment(id, agent, "복원 단위를 바꿨어요", t("2026-11-04T00:00:00Z"));
    close(id, t("2026-11-05T03:00:00Z"), d("2026-11-03"));

    var res =
        service.overview(
            me, MeOverviewPeriod.MONTH, MetricsGranularity.DAY, t("2026-11-11T03:00:00Z"));
    assertThat(res.closed()).hasSize(1);
    var item = res.closed().get(0);
    assertThat(item.projectKey()).isEqualTo(p.key());
    assertThat(item.title()).isEqualTo("드라이브 복원");
    assertThat(item.closedDate()).isEqualTo(d("2026-11-05"));
    assertThat(item.outcome()).isEqualTo(DueOutcome.OVERDUE);
    assertThat(item.lateDays()).isEqualTo(2);
    assertThat(item.withAi()).isTrue();
    assertThat(item.aiNames()).containsExactly("mo-ai");
    assertThat(item.request()).isEqualTo("일괄 삭제한 묶음에서 하나만 복원 @mo-me 확인");
    assertThat(item.lastComment().authorName()).isEqualTo("mo-ai");
    assertThat(item.lastComment().text()).isEqualTo("복원 단위를 바꿨어요");
    assertThat(res.current().completedWithAi()).isEqualTo(1);
    assertThat(res.dailyTotals()).hasSize(11);
  }

  @Test
  void yesterday_comes_from_period_data_when_inside_and_from_separate_call_when_outside() {
    Long me = user("mo-me");
    var p = project(me);
    // 11-08(일) 기한 내 닫힘 + 그날 만든 이슈 하나, 11-10(화) 늦게 닫힘(AI 없이).
    long sun = issue(me, p, "일요일 닫힘", t("2026-11-01T00:00:00Z"));
    assign(sun, me);
    close(sun, t("2026-11-08T03:00:00Z"), d("2026-11-09"));
    issue(me, p, "일요일 만듦", t("2026-11-08T04:00:00Z"));
    long tue = issue(me, p, "화요일 닫힘", t("2026-11-01T00:00:00Z"));
    assign(tue, me);
    close(tue, t("2026-11-10T03:00:00Z"), d("2026-11-05"));

    // 11-11(수) — 어제 11-10 이 이번 달 안: 기간 결과에서 꺼낸 값이 홈 위젯(따로 묻는 값)과 같아야 한다.
    OffsetDateTime wed = t("2026-11-11T03:00:00Z");
    MeDaySummary fromPeriod =
        service.overview(me, MeOverviewPeriod.MONTH, MetricsGranularity.WEEK, wed).day();
    assertThat(fromPeriod).isEqualTo(service.today(me, wed));
    assertThat(fromPeriod.yesterdayCompleted()).isEqualTo(1);
    assertThat(fromPeriod.yesterdayCompletedOnTime()).isZero();

    // 11-09(월) 정오 — 이번 주는 11-09 하루라 어제 11-08 은 기간 밖: 따로 물어 센다.
    OffsetDateTime mon = t("2026-11-09T03:00:00Z");
    MeDaySummary outside =
        service.overview(me, MeOverviewPeriod.WEEK, MetricsGranularity.DAY, mon).day();
    assertThat(outside.yesterday()).isEqualTo(d("2026-11-08"));
    assertThat(outside.yesterdayCompleted()).isEqualTo(1);
    assertThat(outside.yesterdayCompletedOnTime()).isEqualTo(1);
    assertThat(outside.yesterdayCreated()).isEqualTo(1);
    assertThat(outside).isEqualTo(service.today(me, mon));
  }

  @Test
  void closed_list_is_capped_with_total_and_late_top_from_whole_period() {
    Long me = user("mo-me");
    var p = project(me);
    // 가장 오래된(11-01) 이슈가 가장 많이 늦음 — 목록(최근 50건) 밖이어도 늦은 이슈 상위에 나와야 한다.
    long oldLate = issue(me, p, "오래 늦음", t("2026-10-01T00:00:00Z"));
    assign(oldLate, me);
    close(oldLate, t("2026-11-01T03:00:00Z"), d("2026-10-20"));
    int extra = MeOverviewService.CLOSED_LIMIT + 1;
    for (int i = 0; i < extra; i++) {
      long id = issue(me, p, "끝냄 " + i, t("2026-10-01T00:00:00Z"));
      assign(id, me);
      close(id, t("2026-11-02T00:00:00Z").plusMinutes(i), null);
    }

    var res =
        service.overview(
            me, MeOverviewPeriod.MONTH, MetricsGranularity.DAY, t("2026-11-11T03:00:00Z"));
    assertThat(res.closedTotal()).isEqualTo(extra + 1);
    assertThat(res.closed()).hasSize(MeOverviewService.CLOSED_LIMIT);
    assertThat(res.closed().get(0).title()).isEqualTo("끝냄 " + (extra - 1)); // 최근 끝낸 순
    assertThat(res.closed()).noneMatch(c -> c.issueId() == oldLate);
    assertThat(res.lateTop())
        .singleElement()
        .satisfies(
            c -> {
              assertThat(c.issueId()).isEqualTo(oldLate);
              assertThat(c.title()).isEqualTo("오래 늦음");
              assertThat(c.lateDays()).isEqualTo(12);
            });
  }

  @Test
  void displays_skip_deleted_issue_and_issue_in_deleted_project() {
    Long me = user("mo-me");
    var p = project(me);
    var gone = project(me);
    long alive = issue(me, p, "살아 있음", t("2026-11-01T00:00:00Z"));
    long deleted = issue(me, p, "지운 이슈", t("2026-11-01T00:00:00Z"));
    long inDeletedProject = issue(me, gone, "지운 프로젝트 이슈", t("2026-11-01T00:00:00Z"));
    dsl.update(ISSUE)
        .set(ISSUE.DELETED_AT, OffsetDateTime.now())
        .where(ISSUE.ID.eq(deleted))
        .execute();
    dsl.update(PROJECT)
        .set(PROJECT.DELETED_AT, OffsetDateTime.now())
        .where(PROJECT.ID.eq(gone.id()))
        .execute();

    // 서비스는 표시 정보가 없는 id 를 목록에서 뺀다 — 지운 이슈·지운 프로젝트 이슈는 표시 정보가 오지 않아야 한다.
    var displays = repository.findDisplays(List.of(alive, deleted, inDeletedProject));
    assertThat(displays).containsOnlyKeys(alive);
  }

  @Test
  void excerpt_folds_whitespace_and_cuts() {
    assertThat(MeOverviewService.excerpt(null, java.util.Map.of())).isNull();
    assertThat(MeOverviewService.excerpt("  \n ", java.util.Map.of())).isNull();
    String longText = "가".repeat(MeOverviewService.EXCERPT_CHARS + 5);
    assertThat(MeOverviewService.excerpt(longText, java.util.Map.of()))
        .hasSize(MeOverviewService.EXCERPT_CHARS + 1)
        .endsWith("…");
    assertThat(MeOverviewService.excerpt("<@999999999>님", java.util.Map.of())).isEqualTo("@사용자님");
  }
}
