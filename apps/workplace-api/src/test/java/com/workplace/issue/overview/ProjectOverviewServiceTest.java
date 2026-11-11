package com.workplace.issue.overview;

import static com.workplace.jooq.Tables.AGENT_WORK;
import static com.workplace.jooq.Tables.CYCLE;
import static com.workplace.jooq.Tables.ISSUE;
import static com.workplace.jooq.Tables.ISSUE_ASSIGNEE;
import static com.workplace.jooq.Tables.ISSUE_COMMENT;
import static com.workplace.jooq.Tables.ISSUE_CYCLE;
import static com.workplace.jooq.Tables.ISSUE_DEPENDENCY;
import static com.workplace.jooq.Tables.ISSUE_HISTORY;
import static com.workplace.jooq.Tables.ISSUE_TYPE_DEF;
import static com.workplace.jooq.Tables.ISSUE_VERSION;
import static com.workplace.jooq.Tables.PROJECT_VERSION;
import static com.workplace.jooq.Tables.USER;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.workplace.global.security.JwtTokenProvider;
import com.workplace.issue.dto.CreateIssueRequest;
import com.workplace.issue.dto.IssueResponse;
import com.workplace.issue.overview.ProjectOverviewResponse.ActivityGroup;
import com.workplace.issue.overview.ProjectOverviewResponse.AttentionItem;
import com.workplace.issue.overview.ProjectOverviewResponse.Point;
import com.workplace.issue.overview.ProjectOverviewResponse.Progress;
import com.workplace.issue.overview.ProjectOverviewResponse.WorkloadItem;
import com.workplace.issue.service.IssueSearchService;
import com.workplace.issue.service.IssueService;
import com.workplace.project.dto.AddMemberRequest;
import com.workplace.project.dto.CreateProjectRequest;
import com.workplace.project.dto.ProjectResponse;
import com.workplace.project.exception.ProjectNotFoundException;
import com.workplace.project.service.ProjectService;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.TestFixtures;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Collectors;
import org.jooq.DSLContext;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.transaction.annotation.Transactional;

/**
 * WP-1478 — 프로젝트 「개요」 API 통합 테스트. 숫자 카드(취소·하위 작업·에픽·삭제 제외), 진행 중 고르는 순서(사이클 → 버전 → 추이)와 예상 완료, 살펴볼
 * 이슈 정의(오래 멈춤·기다리는 중)와 상위 5건 자르기, 작업량(담당 여럿 각자 셈·AI kind), 최근 활동 묶기, 권한, 이슈 검색 stale·waiting 이 개요
 * 숫자와 같은 이슈를 돌려주는지를 고정한다.
 *
 * <p>「지금」은 서비스의 시각을 받는 판(같은 패키지)으로 넘긴다 — 기본은 2026-11-11 12:00 KST(수요일). 이슈 시각·상태는 직접 갱신한다(지표 모듈
 * 테스트와 같은 방식).
 */
@Transactional
class ProjectOverviewServiceTest extends IntegrationTestBase {

  /** 기본 「지금」 — 서울 2026-11-11(수) 12:00. */
  private static final OffsetDateTime NOW = OffsetDateTime.parse("2026-11-11T12:00:00+09:00");

  private static final LocalDate TODAY = LocalDate.parse("2026-11-11");

  /** 시드 이슈의 기본 생성 시각 — 비교 기간(최근 14일) 밖이라 「새로 생김」에 잡히지 않는다. */
  private static final OffsetDateTime OLD = OffsetDateTime.parse("2026-09-01T12:00:00+09:00");

  @Autowired DSLContext dsl;
  @Autowired IssueService issueService;
  @Autowired IssueSearchService searchService;
  @Autowired ProjectService projectService;
  @Autowired ProjectOverviewService service;
  @Autowired MockMvc mvc;
  @Autowired JwtTokenProvider jwtTokenProvider;

  // ───────────── 시드 헬퍼 ─────────────

  private static OffsetDateTime kst(String localDateTime) {
    return OffsetDateTime.parse(localDateTime + "+09:00");
  }

  private static LocalDate d(String iso) {
    return LocalDate.parse(iso);
  }

  private long human(String name) {
    long id = TestFixtures.createHuman(dsl);
    dsl.update(USER).set(USER.NAME, name).where(USER.ID.eq(id)).execute();
    grantUserRole(id);
    withMembership(id);
    return id;
  }

  private ProjectResponse project(long ownerId) {
    String suffix = UUID.randomUUID().toString().replaceAll("-", "").toUpperCase().substring(0, 4);
    return projectService.create(
        ownerId, new CreateProjectRequest("PO" + suffix, "P-PO" + suffix, "x", "TEAM"));
  }

  private void member(ProjectResponse p, long ownerId, long userId) {
    projectService.addMember(ownerId, p.key(), new AddMemberRequest(userId, "MEMBER"));
  }

  /** 담당자 없는 이슈를 만들고 범주·생성 시각을 정한다. 종료 범주면 닫힌 시각을 생성 시각으로 둔다(필요하면 따로 바꾼다). */
  private long issue(long reporter, ProjectResponse p, String status, OffsetDateTime createdAt) {
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
    boolean closed = "DONE".equals(status) || "CANCELED".equals(status);
    dsl.update(ISSUE)
        .set(ISSUE.STATUS, status)
        .set(ISSUE.STATUS_ID, TestFixtures.defaultStatusId(ISSUE.PROJECT_ID, status))
        .set(ISSUE.CREATED_AT, createdAt)
        .set(ISSUE.UPDATED_AT, createdAt)
        .set(ISSUE.CLOSED_AT, closed ? createdAt : null)
        .where(ISSUE.ID.eq(created.id()))
        .execute();
    return created.id();
  }

  private long open(long reporter, ProjectResponse p) {
    return issue(reporter, p, "TODO", OLD);
  }

  private void due(long issueId, LocalDate due) {
    dsl.update(ISSUE).set(ISSUE.DUE_DATE, due).where(ISSUE.ID.eq(issueId)).execute();
  }

  private void closedAt(long issueId, OffsetDateTime at) {
    dsl.update(ISSUE).set(ISSUE.CLOSED_AT, at).where(ISSUE.ID.eq(issueId)).execute();
  }

  private void assign(long issueId, long userId) {
    dsl.insertInto(ISSUE_ASSIGNEE)
        .set(ISSUE_ASSIGNEE.ISSUE_ID, issueId)
        .set(ISSUE_ASSIGNEE.USER_ID, userId)
        .set(ISSUE_ASSIGNEE.ASSIGNED_BY, userId)
        .execute();
  }

  /** 이슈 유형을 프로젝트의 그 이름 유형(EPIC·SUBTASK)으로 바꾼다. */
  private void type(ProjectResponse p, long issueId, String typeName) {
    Long typeId =
        dsl.select(ISSUE_TYPE_DEF.ID)
            .from(ISSUE_TYPE_DEF)
            .where(ISSUE_TYPE_DEF.PROJECT_ID.eq(p.id()))
            .and(ISSUE_TYPE_DEF.NAME.eq(typeName))
            .fetchOne(ISSUE_TYPE_DEF.ID);
    dsl.update(ISSUE).set(ISSUE.TYPE_ID, typeId).where(ISSUE.ID.eq(issueId)).execute();
  }

  private void parent(long childId, long parentId) {
    dsl.update(ISSUE).set(ISSUE.PARENT_ISSUE_ID, parentId).where(ISSUE.ID.eq(childId)).execute();
  }

  private void delete(long issueId) {
    dsl.update(ISSUE).set(ISSUE.DELETED_AT, OLD).where(ISSUE.ID.eq(issueId)).execute();
  }

  private void history(long issueId, long actorId, String type, OffsetDateTime at) {
    dsl.insertInto(ISSUE_HISTORY)
        .set(ISSUE_HISTORY.ISSUE_ID, issueId)
        .set(ISSUE_HISTORY.ACTOR_ID, actorId)
        .set(ISSUE_HISTORY.EVENT_TYPE, type)
        .set(ISSUE_HISTORY.CREATED_AT, at)
        .execute();
  }

  private void comment(long issueId, long authorId, OffsetDateTime at, boolean deleted) {
    dsl.insertInto(ISSUE_COMMENT)
        .set(ISSUE_COMMENT.ISSUE_ID, issueId)
        .set(ISSUE_COMMENT.AUTHOR_ID, authorId)
        .set(ISSUE_COMMENT.BODY, "댓글")
        .set(ISSUE_COMMENT.CREATED_AT, at)
        .set(ISSUE_COMMENT.DELETED_AT, deleted ? at.plusHours(1) : null)
        .execute();
  }

  private void agentWork(
      long issueId, long agentId, String state, OffsetDateTime at, boolean ended) {
    dsl.insertInto(AGENT_WORK)
        .set(AGENT_WORK.ISSUE_ID, issueId)
        .set(AGENT_WORK.WORKER_ID, agentId)
        // 끝난 작업은 종료 상태여야 한다(CHECK) — 답변 필요였다가 끝난 작업을 COMPLETED 로 둔다.
        .set(AGENT_WORK.STATE, ended ? "COMPLETED" : state)
        .set(AGENT_WORK.STARTED_AT, at)
        .set(AGENT_WORK.STATE_CHANGED_AT, at)
        .set(AGENT_WORK.UPDATED_AT, at)
        .set(AGENT_WORK.ENDED_AT, ended ? at.plusHours(1) : null)
        .execute();
  }

  /** blocker 가 target 을 막는다. */
  private void blocks(long blockerId, long targetId, long by) {
    blocks(blockerId, targetId, by, OffsetDateTime.now());
  }

  /** 선행 의존을 정한 시각에 건다 — 기다린 일수는 아직 열린 선행 중 가장 최근에 걸린 의존의 시각부터 센다. */
  private void blocks(long blockerId, long targetId, long by, OffsetDateTime at) {
    dsl.insertInto(ISSUE_DEPENDENCY)
        .set(ISSUE_DEPENDENCY.ISSUE_ID, blockerId)
        .set(ISSUE_DEPENDENCY.BLOCKS_ISSUE_ID, targetId)
        .set(ISSUE_DEPENDENCY.CREATED_BY, by)
        .set(ISSUE_DEPENDENCY.CREATED_AT, at)
        .execute();
  }

  private long cycle(ProjectResponse p, String status, LocalDate start, LocalDate end) {
    return dsl.insertInto(CYCLE)
        .set(CYCLE.PROJECT_ID, p.id())
        .set(CYCLE.NAME, "C-" + UUID.randomUUID().toString().substring(0, 6))
        .set(CYCLE.STATUS, status)
        .set(CYCLE.START_DATE, start)
        .set(CYCLE.END_DATE, end)
        .returning(CYCLE.ID)
        .fetchOne()
        .getId();
  }

  private void inCycle(long issueId, long cycleId, OffsetDateTime at) {
    dsl.insertInto(ISSUE_CYCLE)
        .set(ISSUE_CYCLE.ISSUE_ID, issueId)
        .set(ISSUE_CYCLE.CYCLE_ID, cycleId)
        .set(ISSUE_CYCLE.CREATED_AT, at)
        .execute();
  }

  private long version(
      ProjectResponse p,
      String name,
      LocalDate start,
      LocalDate release,
      OffsetDateTime releasedAt,
      OffsetDateTime archivedAt) {
    return dsl.insertInto(PROJECT_VERSION)
        .set(PROJECT_VERSION.PROJECT_ID, p.id())
        .set(PROJECT_VERSION.NAME, name)
        .set(PROJECT_VERSION.START_DATE, start)
        .set(PROJECT_VERSION.RELEASE_DATE, release)
        .set(PROJECT_VERSION.RELEASED_AT, releasedAt)
        .set(PROJECT_VERSION.ARCHIVED_AT, archivedAt)
        .returning(PROJECT_VERSION.ID)
        .fetchOne()
        .getId();
  }

  private void fixVersion(long issueId, long versionId) {
    dsl.insertInto(ISSUE_VERSION)
        .set(ISSUE_VERSION.ISSUE_ID, issueId)
        .set(ISSUE_VERSION.VERSION_ID, versionId)
        .set(ISSUE_VERSION.KIND, "FIX")
        .execute();
  }

  private ProjectOverviewResponse overview(long caller, ProjectResponse p) {
    return service.overview(caller, p.key(), NOW);
  }

  private String tokenFor(long userId) {
    return jwtTokenProvider.generateAccessToken(userId, "user-" + userId);
  }

  // ───────────── 숫자 카드·열린 이슈 ─────────────

  @Test
  void cards_and_open_issues_exclude_canceled_deleted_subtask_and_epic() {
    long owner = human("소유자");
    long dev = human("개발자");
    var p = project(owner);
    member(p, owner, dev);

    long soonUnassigned = open(owner, p);
    due(soonUnassigned, TODAY.plusDays(2));
    long soonAssigned = issue(owner, p, "IN_PROGRESS", OLD);
    due(soonAssigned, TODAY.plusDays(6));
    assign(soonAssigned, dev);
    long notSoon = open(owner, p);
    due(notSoon, TODAY.plusDays(7));
    long overdueOld = open(owner, p);
    due(overdueOld, TODAY.minusDays(21));
    assign(overdueOld, dev);
    long overdueNew = open(owner, p);
    due(overdueNew, TODAY.minusDays(3));

    // 섞이면 안 되는 것 — 취소(기한 지남처럼 보이는 마감), 삭제, 하위 작업, 에픽
    long canceled = issue(owner, p, "CANCELED", OLD);
    due(canceled, TODAY.minusDays(30));
    long deleted = open(owner, p);
    due(deleted, TODAY.minusDays(40));
    delete(deleted);
    long subtask = open(owner, p);
    due(subtask, TODAY.minusDays(50));
    type(p, subtask, "SUBTASK");
    long epic = open(owner, p);
    due(epic, TODAY.plusDays(1));
    type(p, epic, "EPIC");

    // 완료 — 최근 7일 1건, 앞 7일 1건, 취소는 완료가 아니다
    long doneRecent = issue(owner, p, "DONE", OLD);
    closedAt(doneRecent, kst("2026-11-10T09:00:00"));
    long donePrev = issue(owner, p, "DONE", OLD);
    closedAt(donePrev, kst("2026-11-01T09:00:00"));
    long canceledRecent = issue(owner, p, "CANCELED", OLD);
    closedAt(canceledRecent, kst("2026-11-10T09:00:00"));
    // 새로 생김 — 최근 7일 1건
    issue(owner, p, "TODO", kst("2026-11-09T10:00:00"));

    var r = overview(owner, p);

    assertThat(r.today()).isEqualTo(TODAY);
    assertThat(r.cards().completed().current()).isEqualTo(1);
    assertThat(r.cards().completed().previous()).isEqualTo(1);
    assertThat(r.cards().created().current()).isEqualTo(1);
    assertThat(r.cards().created().previous()).isZero();
    assertThat(r.cards().dueSoon().count()).isEqualTo(2);
    assertThat(r.cards().dueSoon().unassigned()).isEqualTo(1);
    assertThat(r.cards().overdue().count()).isEqualTo(2);
    assertThat(r.cards().overdue().oldestDays()).isEqualTo(21);

    // 열린 작업 이슈: TODO 5(soonUnassigned·notSoon·overdueOld·overdueNew·새로 생김) + IN_PROGRESS 1
    assertThat(r.openIssues().todo()).isEqualTo(5);
    assertThat(r.openIssues().inProgress()).isEqualTo(1);
    assertThat(r.openIssues().total()).isEqualTo(6);
    assertThat(r.openIssues().unassigned()).isEqualTo(4);

    // 살펴볼 이슈 기한 지남도 같은 범위
    assertThat(r.attention().overdue().total()).isEqualTo(2);
    assertThat(r.attention().overdue().items())
        .extracting(AttentionItem::issueKey)
        .containsExactly(key(p, overdueOld), key(p, overdueNew));
    assertThat(r.attention().overdue().items().get(0).days()).isEqualTo(21);
  }

  private String key(ProjectResponse p, long issueId) {
    return p.key() + "-" + number(issueId);
  }

  /** 이슈 번호(프로젝트 안). */
  private int number(long issueId) {
    return dsl.select(ISSUE.NUMBER).from(ISSUE).where(ISSUE.ID.eq(issueId)).fetchOne(ISSUE.NUMBER);
  }

  // ───────────── 진행 중 ─────────────

  @Test
  void progress_picks_active_cycle_closest_to_end_and_projects_completion() {
    long owner = human("소유자");
    var p = project(owner);
    long near = cycle(p, "ACTIVE", d("2026-11-10"), d("2026-11-23"));
    long far = cycle(p, "ACTIVE", d("2026-11-01"), d("2026-11-30"));
    long planned = cycle(p, "PLANNED", d("2026-11-01"), d("2026-11-12"));
    OffsetDateTime added = kst("2026-11-10T09:00:00");

    long done1 = issue(owner, p, "DONE", OLD);
    closedAt(done1, kst("2026-11-10T15:00:00"));
    long done2 = issue(owner, p, "DONE", OLD);
    // 서울 자정 직후 — UTC 로는 전날이지만 서울 날짜 11/11 로 센다
    closedAt(done2, kst("2026-11-11T00:30:00"));
    long working = issue(owner, p, "IN_PROGRESS", OLD);
    long todo = open(owner, p);
    long canceled = issue(owner, p, "CANCELED", OLD);
    long sub = open(owner, p);
    type(p, sub, "SUBTASK");
    for (long id : List.of(done1, done2, working, todo, canceled, sub)) {
      inCycle(id, near, added);
    }
    // 오늘 들어온 이슈 — 어제 점의 범위에는 없다
    long lateAdd = open(owner, p);
    inCycle(lateAdd, near, kst("2026-11-11T08:00:00"));
    inCycle(open(owner, p), far, added);
    inCycle(open(owner, p), planned, added);

    Progress pr = overview(owner, p).progress();

    assertThat(pr.kind()).isEqualTo("CYCLE");
    assertThat(pr.target().id()).isEqualTo(near);
    assertThat(pr.target().start()).isEqualTo(d("2026-11-10"));
    assertThat(pr.target().end()).isEqualTo(d("2026-11-23"));
    assertThat(pr.total()).isEqualTo(5);
    assertThat(pr.done()).isEqualTo(2);
    assertThat(pr.points())
        .containsExactly(new Point(d("2026-11-10"), 4, 1), new Point(d("2026-11-11"), 5, 2));
    // 남은 = 5 − 2 − 0.25 = 2.75, 속도 = 2건 ÷ 2일(기간 시작 11/10 부터) = 1 → ceil(2.75) = 3일 뒤
    assertThat(pr.projectedDate()).isEqualTo(d("2026-11-14"));
    assertThat(pr.lateDays()).isEqualTo(-9);
    assertThat(pr.trendDelta()).isNull();
  }

  @Test
  void progress_uses_unreleased_version_when_no_active_cycle_and_reports_late_days() {
    long owner = human("소유자");
    var p = project(owner);
    cycle(p, "COMPLETED", d("2026-10-01"), d("2026-10-14"));
    // 후보가 아닌 버전 — 출시됨·보관됨·출시일 없음, 그리고 더 먼 출시일
    version(p, "released", null, d("2026-11-12"), OLD, null);
    version(p, "archived", null, d("2026-11-12"), null, OLD);
    version(p, "nodate", null, null, null, null);
    version(p, "later", null, d("2026-12-31"), null, null);
    long v = version(p, "v1", d("2026-11-01"), d("2026-11-12"), null, null);

    long done = issue(owner, p, "DONE", OLD);
    closedAt(done, kst("2026-11-11T10:00:00"));
    long todo = open(owner, p);
    fixVersion(done, v);
    fixVersion(todo, v);

    Progress pr = overview(owner, p).progress();

    assertThat(pr.kind()).isEqualTo("VERSION");
    assertThat(pr.target().id()).isEqualTo(v);
    assertThat(pr.target().start()).isEqualTo(d("2026-11-01"));
    assertThat(pr.target().end()).isEqualTo(d("2026-11-12"));
    assertThat(pr.total()).isEqualTo(2);
    assertThat(pr.done()).isEqualTo(1);
    // 버전 범위는 평평 — 11/01 ~ 11/11 11점, 범위는 늘 2
    assertThat(pr.points()).hasSize(11);
    assertThat(pr.points()).allMatch(pt -> pt.scope() == 2);
    assertThat(pr.points().get(10)).isEqualTo(new Point(TODAY, 2, 1));
    // 남은 1, 속도 = 1건 ÷ 11일(11/01~11/11) → 11일 뒤 11/22, 출시일 11/12 보다 10일 늦음
    assertThat(pr.projectedDate()).isEqualTo(d("2026-11-22"));
    assertThat(pr.lateDays()).isEqualTo(10);
  }

  @Test
  void version_without_start_uses_four_weeks_and_zero_velocity_has_no_projection() {
    long owner = human("소유자");
    var p = project(owner);
    long v = version(p, "v2", null, d("2026-11-20"), null, null);
    fixVersion(open(owner, p), v);
    fixVersion(issue(owner, p, "IN_PROGRESS", OLD), v);

    Progress pr = overview(owner, p).progress();

    assertThat(pr.kind()).isEqualTo("VERSION");
    assertThat(pr.target().start()).isEqualTo(d("2026-10-24"));
    assertThat(pr.projectedDate()).isNull();
    assertThat(pr.lateDays()).isNull();
  }

  @Test
  void progress_falls_back_to_trend_and_epics_list_recent_movement() {
    long owner = human("소유자");
    var p = project(owner);
    // 9/1 생성·열림, 11/5 생성·열림, 9/1 생성·10/1 닫힘(첫 시점 9/21 에는 열려 있었다)
    open(owner, p);
    issue(owner, p, "TODO", kst("2026-11-05T10:00:00"));
    long closed = issue(owner, p, "DONE", OLD);
    closedAt(closed, kst("2026-10-01T10:00:00"));

    long epicA = issue(owner, p, "IN_PROGRESS", kst("2026-10-01T10:00:00"));
    type(p, epicA, "EPIC");
    long epicB = issue(owner, p, "TODO", kst("2026-10-02T10:00:00"));
    type(p, epicB, "EPIC");
    long epicDone = issue(owner, p, "DONE", OLD);
    type(p, epicDone, "EPIC");
    // epicA 의 자식이 가장 최근에 움직였다 → epicA 가 먼저
    long childA1 = issue(owner, p, "DONE", OLD);
    long childA2 = open(owner, p);
    parent(childA1, epicA);
    parent(childA2, epicA);
    dsl.update(ISSUE)
        .set(ISSUE.UPDATED_AT, kst("2026-11-10T10:00:00"))
        .where(ISSUE.ID.eq(childA2))
        .execute();

    Progress pr = overview(owner, p).progress();

    assertThat(pr.kind()).isEqualTo("TREND");
    assertThat(pr.target()).isNull();
    assertThat(pr.done()).isNull();
    assertThat(pr.projectedDate()).isNull();
    assertThat(pr.points()).hasSize(8);
    assertThat(pr.points().get(0).date()).isEqualTo(d("2026-09-21"));
    assertThat(pr.points().get(7).date()).isEqualTo(TODAY);
    assertThat(pr.points()).allMatch(pt -> pt.done() == null);
    // 9/21: 9/1 열림 + 9/1~10/1 열림 + 자식 childA2 는 열린 작업 이슈(에픽 하위지만 SUBTASK 유형 아님) = 3
    // 오늘: 9/1 열림 + 11/5 열림 + childA2 = 3
    assertThat(pr.points().get(0).scope()).isEqualTo(3);
    assertThat(pr.points().get(7).scope()).isEqualTo(3);
    assertThat(pr.trendDelta()).isZero();
    assertThat(pr.total()).isEqualTo(3);

    // 에픽 유형 id — 웹이 이슈 탭 에픽 필터 링크를 만든다
    assertThat(pr.epics().epicTypeId())
        .isEqualTo(
            dsl.select(ISSUE.TYPE_ID)
                .from(ISSUE)
                .where(ISSUE.ID.eq(epicA))
                .fetchOne(ISSUE.TYPE_ID));
    assertThat(pr.epics().inProgress()).isEqualTo(1);
    assertThat(pr.epics().total()).isEqualTo(2);
    assertThat(pr.epics().items()).hasSize(2);
    assertThat(pr.epics().items().get(0).issueKey()).isEqualTo(key(p, epicA));
    assertThat(pr.epics().items().get(0).number()).isEqualTo(number(epicA));
    assertThat(pr.epics().items().get(0).done()).isEqualTo(1);
    assertThat(pr.epics().items().get(0).total()).isEqualTo(2);
    assertThat(pr.epics().items().get(1).issueKey()).isEqualTo(key(p, epicB));
  }

  @Test
  void empty_project_returns_zeros_and_can_manage_only_for_owner_or_admin() {
    long owner = human("소유자");
    long plain = human("멤버");
    long admin = human("관리자");
    TestFixtures.grantRole(dsl, admin, "ADMIN");
    var p = project(owner);
    member(p, owner, plain);

    var r = overview(owner, p);
    assertThat(r.canManage()).isTrue();
    assertThat(r.cards().completed().current()).isZero();
    assertThat(r.cards().overdue().count()).isZero();
    assertThat(r.cards().overdue().oldestDays()).isNull();
    assertThat(r.openIssues().total()).isZero();
    assertThat(r.attention().total()).isZero();
    assertThat(r.attention().overdue().items()).isEmpty();
    assertThat(r.attention().stale().items()).isEmpty();
    assertThat(r.attention().waiting().items()).isEmpty();
    assertThat(r.workload().top()).isEmpty();
    assertThat(r.workload().unassigned()).isZero();
    assertThat(r.workload().others().people()).isZero();
    assertThat(r.activity()).isEmpty();
    assertThat(r.progress().kind()).isEqualTo("TREND");
    assertThat(r.progress().trendDelta()).isZero();
    assertThat(r.progress().epics().total()).isZero();
    assertThat(r.progress().epics().items()).isEmpty();

    assertThat(overview(plain, p).canManage()).isFalse();
    assertThat(overview(admin, p).canManage()).isTrue();
  }

  // ───────────── 살펴볼 이슈·작업량 ─────────────

  @Test
  void attention_groups_keep_top_five_with_exact_totals_and_workload_counts_each_assignee() {
    long owner = human("소유자");
    var p = project(owner);
    long agent = createAgentUserWithMembership("ai-dev");
    List<Long> people = new java.util.ArrayList<>();
    for (int i = 0; i < 6; i++) {
      long u = human("사람" + i);
      member(p, owner, u);
      people.add(u);
    }
    member(p, owner, agent);

    // 기한 지남 7건 — 1~7일 지남
    List<Long> overdue = new java.util.ArrayList<>();
    for (int i = 1; i <= 7; i++) {
      long id = open(owner, p);
      due(id, TODAY.minusDays(i));
      overdue.add(id);
    }
    // 작업량 — AI 3건(그중 하나는 사람0 과 함께), 사람0 2건, 사람1~5 각 1건, 담당 없음 1건
    assign(overdue.get(6), agent);
    assign(overdue.get(6), people.get(0));
    assign(overdue.get(5), agent);
    assign(overdue.get(4), agent);
    assign(overdue.get(3), people.get(0));
    for (int i = 1; i <= 5; i++) {
      long id = open(owner, p);
      assign(id, people.get(i));
    }
    // 닫힌 이슈 담당은 작업량에 들지 않는다
    long closed = issue(owner, p, "DONE", OLD);
    assign(closed, people.get(5));

    var r = overview(owner, p);

    assertThat(r.attention().overdue().total()).isEqualTo(7);
    assertThat(r.attention().overdue().items()).hasSize(5);
    assertThat(r.attention().overdue().items())
        .extracting(AttentionItem::days)
        .containsExactly(7, 6, 5, 4, 3);
    AttentionItem first = r.attention().overdue().items().get(0);
    assertThat(first.assignees())
        .extracting(a -> a.kind())
        .containsExactlyInAnyOrder("AGENT", "HUMAN");
    assertThat(r.attention().total()).isEqualTo(7);

    assertThat(r.workload().top()).hasSize(5);
    assertThat(r.workload().top().get(0).id()).isEqualTo(agent);
    assertThat(r.workload().top().get(0).kind()).isEqualTo("AGENT");
    assertThat(r.workload().top().get(0).count()).isEqualTo(3);
    assertThat(r.workload().top().get(1).id()).isEqualTo(people.get(0));
    assertThat(r.workload().top().get(1).count()).isEqualTo(2);
    assertThat(r.workload().top()).extracting(WorkloadItem::count).containsExactly(3, 2, 1, 1, 1);
    assertThat(r.workload().others().people()).isEqualTo(2);
    assertThat(r.workload().others().issues()).isEqualTo(2);
    // 담당 없음: 기한 지남 7건 중 담당 없는 3건(overdue 0·1·2)
    assertThat(r.workload().unassigned()).isEqualTo(3);
  }

  @Test
  void stale_and_waiting_follow_their_definitions() {
    long owner = human("소유자");
    long agent = createAgentUserWithMembership("ai");
    var p = project(owner);
    OffsetDateTime old = kst("2026-10-01T10:00:00");

    long staleNoActivity = issue(owner, p, "IN_PROGRESS", old);
    long commented = issue(owner, p, "IN_PROGRESS", old);
    comment(commented, owner, kst("2026-11-08T10:00:00"), false);
    long deletedComment = issue(owner, p, "IN_PROGRESS", old);
    comment(deletedComment, owner, kst("2026-11-08T10:00:00"), true);
    long statusMoved = issue(owner, p, "IN_PROGRESS", old);
    history(statusMoved, owner, "STATUS_CHANGED", kst("2026-11-09T10:00:00"));
    long otherHistory = issue(owner, p, "IN_PROGRESS", old);
    // 상태 변경이 아닌 이력은 움직임이 아니다
    history(otherHistory, owner, "TITLE_CHANGED", kst("2026-11-10T10:00:00"));
    long todoOld = issue(owner, p, "TODO", old);
    long staleSubtask = issue(owner, p, "IN_PROGRESS", old);
    type(p, staleSubtask, "SUBTASK");

    long askingAi = issue(owner, p, "TODO", old);
    agentWork(askingAi, agent, "INPUT_REQUIRED", kst("2026-11-01T10:00:00"), false);
    long endedAsk = issue(owner, p, "TODO", old);
    agentWork(endedAsk, agent, "INPUT_REQUIRED", kst("2026-11-01T10:00:00"), true);
    long working = issue(owner, p, "TODO", old);
    agentWork(working, agent, "WORKING", kst("2026-11-01T10:00:00"), false);
    long blocked = issue(owner, p, "TODO", kst("2026-11-05T10:00:00"));
    blocks(todoOld, blocked, owner, kst("2026-11-05T10:00:00"));
    long blockedByDone = issue(owner, p, "TODO", old);
    long doneBlocker = issue(owner, p, "DONE", old);
    blocks(doneBlocker, blockedByDone, owner);

    var r = overview(owner, p);

    assertThat(r.attention().stale().items())
        .extracting(AttentionItem::issueKey)
        .containsExactlyInAnyOrder(
            key(p, staleNoActivity), key(p, deletedComment), key(p, otherHistory));
    assertThat(r.attention().stale().total()).isEqualTo(3);
    assertThat(r.attention().stale().items()).allMatch(i -> i.days() == 41);

    assertThat(r.attention().waiting().items())
        .extracting(AttentionItem::issueKey)
        .containsExactly(key(p, askingAi), key(p, blocked));
    assertThat(r.attention().waiting().total()).isEqualTo(2);
    assertThat(r.attention().waiting().items().get(0).days()).isEqualTo(10);
    assertThat(r.attention().waiting().items().get(1).days()).isEqualTo(6);
    assertThat(r.attention().total()).isEqualTo(5);
  }

  @Test
  void blocked_issue_waiting_days_count_from_open_blocking_dependency_not_last_edit() {
    long owner = human("소유자");
    var p = project(owner);
    OffsetDateTime old = kst("2026-10-01T10:00:00");

    long blocked = issue(owner, p, "TODO", old);
    long earlyBlocker = issue(owner, p, "TODO", old);
    long lateBlocker = issue(owner, p, "TODO", old);
    long doneBlocker = issue(owner, p, "DONE", old);
    blocks(earlyBlocker, blocked, owner, kst("2026-11-01T10:00:00"));
    blocks(lateBlocker, blocked, owner, kst("2026-11-03T10:00:00"));
    // 닫힌 선행 의존은 더 최근에 걸렸어도 기다림의 시작이 아니다
    blocks(doneBlocker, blocked, owner, kst("2026-11-09T10:00:00"));
    // 막힌 이슈를 어제 고쳤다(제목·설명 수정) — 수정 시각이 기다린 일수를 되돌리면 안 된다
    dsl.update(ISSUE)
        .set(ISSUE.UPDATED_AT, kst("2026-11-10T10:00:00"))
        .where(ISSUE.ID.eq(blocked))
        .execute();

    var r = overview(owner, p);

    assertThat(r.attention().waiting().items())
        .extracting(AttentionItem::issueKey)
        .containsExactly(key(p, blocked));
    // 아직 열린 선행 중 가장 최근 의존(11-03)부터 — 11-11 까지 8일
    assertThat(r.attention().waiting().items().get(0).days()).isEqualTo(8);
  }

  @Test
  void search_stale_and_waiting_return_same_issues_as_overview_totals() {
    long owner = human("소유자");
    long agent = createAgentUserWithMembership("ai");
    var p = project(owner);
    OffsetDateTime longAgo = OffsetDateTime.now().minusDays(60);

    long stale1 = issue(owner, p, "IN_PROGRESS", longAgo);
    long stale2 = issue(owner, p, "IN_PROGRESS", longAgo);
    long fresh = issue(owner, p, "IN_PROGRESS", longAgo);
    comment(fresh, owner, OffsetDateTime.now().minusDays(1), false);
    long staleEpic = issue(owner, p, "IN_PROGRESS", longAgo);
    type(p, staleEpic, "EPIC");
    long ask = issue(owner, p, "TODO", longAgo);
    agentWork(ask, agent, "INPUT_REQUIRED", longAgo, false);
    long blocked = issue(owner, p, "TODO", longAgo);
    blocks(stale1, blocked, owner);

    var r = service.overview(owner, p.key(), OffsetDateTime.now());

    // 이슈 탭 기본 범위(에픽·하위 작업 제외)를 함께 보낸다 — 웹 이슈 탭과 같은 요청
    Map<String, String> base = new HashMap<>();
    base.put("excludeSubtasks", "true");
    base.put("excludeEpics", "true");
    Map<String, String> staleParams = new HashMap<>(base);
    staleParams.put("stale", "true");
    Map<String, String> waitingParams = new HashMap<>(base);
    waitingParams.put("waiting", "true");

    Set<Long> staleIds = ids(searchService.search(owner, p.key(), staleParams).items());
    Set<Long> waitingIds = ids(searchService.search(owner, p.key(), waitingParams).items());

    assertThat(staleIds).containsExactlyInAnyOrder(stale1, stale2);
    assertThat(staleIds).hasSize(r.attention().stale().total());
    assertThat(waitingIds).containsExactlyInAnyOrder(ask, blocked);
    assertThat(waitingIds).hasSize(r.attention().waiting().total());

    // 횡단(/me/issues) 경로도 같은 필터를 받는다
    Map<String, String> mine = new HashMap<>(staleParams);
    mine.put("reporter", "me");
    assertThat(ids(searchService.searchMine(owner, mine).items())).contains(stale1, stale2);
  }

  private static Set<Long> ids(List<IssueResponse> items) {
    return items.stream().map(IssueResponse::id).collect(Collectors.toSet());
  }

  // ───────────── 최근 활동 ─────────────

  @Test
  void activity_groups_consecutive_same_actor_and_type() {
    long a = human("가");
    long b = human("나");
    var p = project(a);
    member(p, a, b);
    long i1 = open(a, p);
    long i2 = open(a, p);
    long gone = open(a, p);
    delete(gone);

    // 최신 → 과거: 가 상태×3(이력 3건, 서로 다른 이슈 i1·i2 — 삭제된 gone 은 빠진다) / 나 제목×1 / 가 상태×1
    history(i1, a, "STATUS_CHANGED", kst("2026-11-11T10:00:00"));
    history(gone, a, "STATUS_CHANGED", kst("2026-11-11T09:59:00"));
    history(i2, a, "STATUS_CHANGED", kst("2026-11-11T09:30:00"));
    history(i1, a, "STATUS_CHANGED", kst("2026-11-11T09:00:00"));
    history(i2, b, "TITLE_CHANGED", kst("2026-11-11T08:00:00"));
    history(i1, a, "STATUS_CHANGED", kst("2026-11-11T07:00:00"));

    List<ActivityGroup> groups = overview(a, p).activity();

    assertThat(groups).hasSize(3);
    assertThat(groups.get(0).actor().id()).isEqualTo(a);
    assertThat(groups.get(0).eventType()).isEqualTo("STATUS_CHANGED");
    // 삭제된 이슈 이력은 빠지고, i1 을 두 번 바꾼 것은 1건 — 서로 다른 이슈 2건
    assertThat(groups.get(0).count()).isEqualTo(2);
    assertThat(groups.get(0).issue()).isNull();
    assertThat(groups.get(0).latestAt().toInstant())
        .isEqualTo(kst("2026-11-11T10:00:00").toInstant());
    assertThat(groups.get(1).actor().id()).isEqualTo(b);
    assertThat(groups.get(1).count()).isEqualTo(1);
    assertThat(groups.get(1).issue().issueKey()).isEqualTo(key(p, i2));
    assertThat(groups.get(1).issue().number()).isEqualTo(number(i2));
    assertThat(groups.get(2).count()).isEqualTo(1);
  }

  @Test
  void activity_counts_distinct_issues_and_merges_assignee_event_kinds() {
    long a = human("가");
    long b = human("나");
    var p = project(a);
    member(p, a, b);
    long i1 = open(a, p);
    long i2 = open(a, p);

    // 최신 → 과거: 가 i1 상태×3 / 나 담당(옛 단일·새 여럿 이벤트 섞임, i1·i2) / 가 i2 담당(옛 이벤트)
    history(i1, a, "STATUS_CHANGED", kst("2026-11-11T10:00:00"));
    history(i1, a, "STATUS_CHANGED", kst("2026-11-11T09:50:00"));
    history(i1, a, "STATUS_CHANGED", kst("2026-11-11T09:40:00"));
    history(i1, b, "ASSIGNEES_CHANGED", kst("2026-11-11T09:00:00"));
    history(i2, b, "ASSIGNEE_CHANGED", kst("2026-11-11T08:50:00"));
    history(i2, a, "ASSIGNEE_CHANGED", kst("2026-11-11T08:00:00"));

    List<ActivityGroup> groups = overview(a, p).activity();

    assertThat(groups).hasSize(3);
    // 한 이슈 상태를 세 번 바꾼 것은 1건 — 그 이슈를 보여 준다
    assertThat(groups.get(0).eventType()).isEqualTo("STATUS_CHANGED");
    assertThat(groups.get(0).count()).isEqualTo(1);
    assertThat(groups.get(0).issue().issueKey()).isEqualTo(key(p, i1));
    // 옛·새 담당 이벤트는 한 종류로 묶이고 ASSIGNEES_CHANGED 로 나간다
    assertThat(groups.get(1).actor().id()).isEqualTo(b);
    assertThat(groups.get(1).eventType()).isEqualTo("ASSIGNEES_CHANGED");
    assertThat(groups.get(1).count()).isEqualTo(2);
    assertThat(groups.get(1).issue()).isNull();
    assertThat(groups.get(2).eventType()).isEqualTo("ASSIGNEES_CHANGED");
    assertThat(groups.get(2).issue().issueKey()).isEqualTo(key(p, i2));
  }

  @Test
  void activity_returns_at_most_six_groups() {
    long a = human("가");
    long b = human("나");
    var p = project(a);
    member(p, a, b);
    long i1 = open(a, p);
    OffsetDateTime t = kst("2026-11-11T10:00:00");
    for (int k = 0; k < 10; k++) {
      history(i1, k % 2 == 0 ? a : b, "STATUS_CHANGED", t.minusMinutes(k));
    }
    assertThat(overview(a, p).activity()).hasSize(6);
  }

  // ───────────── 권한·응답 모양 ─────────────

  @Test
  void non_member_of_private_project_gets_404() {
    long owner = human("소유자");
    long stranger = human("남");
    var p = project(owner);
    assertThatThrownBy(() -> overview(stranger, p)).isInstanceOf(ProjectNotFoundException.class);
  }

  @Test
  void endpoint_requires_login_hides_private_project_and_returns_contract_fields()
      throws Exception {
    long owner = human("소유자");
    long stranger = human("남");
    var p = project(owner);
    long id = open(owner, p);
    due(id, LocalDate.now().minusDays(400));
    assign(id, owner);

    mvc.perform(get("/api/v1/projects/" + p.key() + "/overview"))
        .andExpect(status().isUnauthorized());
    mvc.perform(
            get("/api/v1/projects/" + p.key() + "/overview")
                .header("Authorization", "Bearer " + tokenFor(stranger)))
        .andExpect(status().isNotFound());
    mvc.perform(
            get("/api/v1/projects/" + p.key() + "/overview")
                .header("Authorization", "Bearer " + tokenFor(owner)))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.today").isString())
        .andExpect(jsonPath("$.canManage").value(true))
        .andExpect(jsonPath("$.cards.completed.current").value(0))
        .andExpect(jsonPath("$.cards.created.previous").isNumber())
        .andExpect(jsonPath("$.cards.dueSoon.unassigned").value(0))
        .andExpect(jsonPath("$.cards.overdue.count").value(1))
        .andExpect(jsonPath("$.cards.overdue.oldestDays").isNumber())
        .andExpect(jsonPath("$.progress.kind").value("TREND"))
        .andExpect(jsonPath("$.progress.target").doesNotExist())
        .andExpect(jsonPath("$.progress.points.length()").value(8))
        .andExpect(jsonPath("$.progress.trendDelta").isNumber())
        .andExpect(jsonPath("$.progress.epics.items").isArray())
        .andExpect(jsonPath("$.openIssues.total").value(1))
        .andExpect(jsonPath("$.attention.total").value(1))
        .andExpect(jsonPath("$.attention.overdue.items[0].issueKey").value(key(p, id)))
        .andExpect(jsonPath("$.attention.overdue.items[0].assignees[0].id").value(owner))
        .andExpect(jsonPath("$.attention.overdue.items[0].assignees[0].kind").value("HUMAN"))
        .andExpect(jsonPath("$.attention.overdue.items[0].assignees[0].active").value(true))
        .andExpect(jsonPath("$.attention.overdue.items[0].assignees[0].avatarUrl").doesNotExist())
        .andExpect(jsonPath("$.progress.inProgress").doesNotExist())
        .andExpect(jsonPath("$.attention.stale.items").isArray())
        .andExpect(jsonPath("$.attention.waiting.total").value(0))
        .andExpect(jsonPath("$.workload.top[0].count").value(1))
        .andExpect(jsonPath("$.workload.top[0].active").value(true))
        .andExpect(jsonPath("$.workload.others.people").value(0))
        .andExpect(jsonPath("$.workload.unassigned").value(0))
        .andExpect(jsonPath("$.activity").isArray());
  }
}
