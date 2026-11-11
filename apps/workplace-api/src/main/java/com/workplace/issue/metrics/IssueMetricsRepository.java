package com.workplace.issue.metrics;

import static com.workplace.jooq.Tables.AGENT_WORK;
import static com.workplace.jooq.Tables.AGENT_WORK_EVENT;
import static com.workplace.jooq.Tables.ISSUE;
import static com.workplace.jooq.Tables.ISSUE_ASSIGNEE;
import static com.workplace.jooq.Tables.ISSUE_HISTORY;
import static com.workplace.jooq.Tables.PROJECT;
import static com.workplace.jooq.Tables.USER;

import com.workplace.global.share.ProjectMembership;
import com.workplace.issue.dto.AgentWorkState;
import com.workplace.issue.dto.IssueHistoryEventType;
import com.workplace.issue.dto.IssueStatuses;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.util.Collection;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import lombok.RequiredArgsConstructor;
import org.jooq.Condition;
import org.jooq.DSLContext;
import org.jooq.Field;
import org.jooq.impl.DSL;
import org.springframework.stereotype.Repository;

/**
 * 성과 지표용 jOOQ 조회(WP-1476). 계산은 하지 않고 {@link IssueMetricsCalculator} 가 쓸 원재료만 가져온다.
 *
 * <p>쿼리 수는 이슈 수와 무관하게 고정이다 — ① 완료 후보 ② 후보의 이력(담당자·마감일 변경 2종) ③ 후보의 현재 담당자 ④ 후보의 AI 최초 실제 작업 시각 ⑤ 새로
 * 생긴 이슈의 생성 시각 ⑥ 이력·현재 담당자에 나오는 사람 전부의 kind. id 목록은 {@code = ANY(?)} 배열 하나로 바인딩해 이슈가 많아도 PostgreSQL
 * 바인드 상한(65535)을 넘지 않는다.
 *
 * <p>삭제된 이슈·삭제된 프로젝트는 모든 조회에서 뺀다 — 프로젝트 soft-delete 는 소속 이슈를 정리하지 않으므로(WP-786) 프로젝트 조건이 필요하다.
 */
@Repository
@RequiredArgsConstructor
public class IssueMetricsRepository {

  /** 담당자 변경 이력 유형 — 현재 다중 담당자 모양. 옛 단일 담당 {@code ASSIGNEE_CHANGED} 는 재구성에 쓰지 않는다(모양이 달라서). */
  static final String ASSIGNEES_CHANGED = IssueHistoryEventType.ASSIGNEES_CHANGED.name();

  /** 마감일 변경 이력 유형 — from/to 는 {@code LocalDate.toString()} 또는 null. */
  static final String DUE_DATE_CHANGED = IssueHistoryEventType.DUE_DATE_CHANGED.name();

  /** AI 가 실제로 일했다고 보지 않는 상태 — 착수 전(SUBMITTED), 착수 전 취소(CANCELED), 거절(REJECTED). */
  private static final List<String> NOT_RUN_STATES =
      List.of(AgentWorkState.SUBMITTED, AgentWorkState.CANCELED, AgentWorkState.REJECTED);

  private final DSLContext dsl;

  /** 완료 후보 이슈 원재료 — 닫힌 시각·생성 시각·현재 마감일. */
  public record ClosedCandidate(
      long issueId,
      long projectId,
      OffsetDateTime createdAt,
      OffsetDateTime closedAt,
      LocalDate currentDueDate) {}

  /** 이력 한 행(담당자·마감일 변경). id 는 건너뛴 행을 로그로 가리킬 때 쓴다(정렬은 조회가 한다). */
  public record HistoryEvent(
      long id,
      long issueId,
      String eventType,
      String fromValue,
      String toValue,
      OffsetDateTime createdAt) {}

  /** 현재 담당자 한 명. 종류(kind)는 ⑥ 에서 다른 사람들과 함께 한 번에 정한다. */
  public record CurrentAssignee(long issueId, long userId) {}

  /** 프로젝트 기준 범위 — 그 프로젝트의 살아 있는 이슈. 권한은 서비스가 {@code assertReadable} 로 먼저 본다. */
  public Condition projectScope(long projectId) {
    return ISSUE.PROJECT_ID.eq(projectId);
  }

  /**
   * 사람 기준 범위 — 사람이 지금 읽을 수 있는 프로젝트의 이슈. {@code IssueRepository.watchedReadableCondition} 과 같은
   * 규칙(OPEN 이거나 멤버)에, 개인 프로젝트는 소유자만 본다는 {@code ProjectAccessGuard} 규칙을 더했다 — 개인 프로젝트에 다른 멤버 행이 생겨도
   * 남의 개인 프로젝트 이슈가 섞이지 않게. 이 조건을 쓰는 조회(①⑤)는 모두 PROJECT 를 조인하므로 별도 EXISTS 없이 조인된 행에 바로 건다. 프로젝트 삭제
   * 여부는 각 조회가 따로 본다.
   */
  public Condition readableBy(long userId) {
    return PROJECT
        .TYPE
        .eq("OPEN")
        .or(
            ProjectMembership.isMemberOf(ISSUE.PROJECT_ID, userId)
                .and(PROJECT.TYPE.ne("PERSONAL").or(PROJECT.OWNER_ID.eq(userId))));
  }

  /**
   * 사람 기준 완료 후보를 좁히는 조건 — 지금 담당자이거나, 담당자 변경 이력 payload 에 그 사람 id 가 나오는 이슈. 「닫힐 때 담당자」 판정은 계산기가 자바에서
   * 하고, 이 조건은 상위 집합으로 좁히기만 한다(테넌트의 모든 완료 이슈를 가져오지 않게).
   *
   * <p>payload 를 {@code ::jsonb} 로 캐스팅하지 않는다 — 깨진 행 하나가 쿼리 전체를 실패시킨다. 대신 PostgreSQL 정규식 <code>
   * "id"\s*:\s*N\s*[,&#125;]</code> 로 찾는다 — 키 순서·공백에 기대지 않고, {@code "id":12} 가 {@code "id":123} 에
   * 걸리지 않으며(숫자 뒤의 <code>\s*[,&#125;]</code> 가 끊는다), 대소문자를 가려 {@code "componentId"} 와도 겹치지 않는다. N 은
   * long 이라 패턴에 정규식 메타문자가 들어갈 수 없고, 패턴 전체는 바인드 값으로 넘긴다. 모양이 달라 놓친 행이 있어도 그 사람이 지금 담당자면 첫 조건으로
   * 잡힌다(그래서 현재 담당 EXISTS 를 먼저 둔다).
   */
  public Condition assigneeCandidate(long userId) {
    return DSL.exists(
            DSL.selectOne()
                .from(ISSUE_ASSIGNEE)
                .where(ISSUE_ASSIGNEE.ISSUE_ID.eq(ISSUE.ID))
                .and(ISSUE_ASSIGNEE.USER_ID.eq(userId)))
        .or(
            DSL.exists(
                DSL.selectOne()
                    .from(ISSUE_HISTORY)
                    .where(ISSUE_HISTORY.ISSUE_ID.eq(ISSUE.ID))
                    .and(ISSUE_HISTORY.EVENT_TYPE.eq(ASSIGNEES_CHANGED))
                    .and(ISSUE_HISTORY.TO_VALUE.likeRegex(assigneeIdPattern(userId)))));
  }

  /** 담당자 변경 payload 에서 사람 id 한 명을 찾는 정규식 — {@link #assigneeCandidate} 참조. */
  static String assigneeIdPattern(long userId) {
    return "\"id\"\\s*:\\s*" + userId + "\\s*[,}]";
  }

  /** 살아 있는 이슈 — 이슈도, 소속 프로젝트도 삭제되지 않았다(①⑤ 공통, PROJECT 조인 전제). */
  private static Condition alive() {
    return ISSUE.DELETED_AT.isNull().and(PROJECT.DELETED_AT.isNull());
  }

  /**
   * ① 범위 안에서 [from, toExclusive) 에 닫힌 DONE 이슈. 다시 열렸다 닫힌 이슈는 closed_at 이 마지막 닫힘이라 그 시각으로 걸리고, 지금 열린
   * 이슈는 closed_at 이 null 이라 빠진다. CANCELED 는 완료가 아니므로 뺀다. 프로젝트 기준은 {@code idx_issue_project_closed}
   * 를 탄다(V278).
   */
  public List<ClosedCandidate> findClosedDone(
      Condition scope, OffsetDateTime from, OffsetDateTime toExclusive) {
    return dsl.select(ISSUE.ID, ISSUE.PROJECT_ID, ISSUE.CREATED_AT, ISSUE.CLOSED_AT, ISSUE.DUE_DATE)
        .from(ISSUE)
        .join(PROJECT)
        .on(PROJECT.ID.eq(ISSUE.PROJECT_ID))
        .where(scope)
        .and(alive())
        .and(ISSUE.STATUS.eq(IssueStatuses.DONE))
        .and(ISSUE.CLOSED_AT.ge(from))
        .and(ISSUE.CLOSED_AT.lt(toExclusive))
        .fetch(
            r ->
                new ClosedCandidate(
                    r.get(ISSUE.ID),
                    r.get(ISSUE.PROJECT_ID),
                    r.get(ISSUE.CREATED_AT),
                    r.get(ISSUE.CLOSED_AT),
                    r.get(ISSUE.DUE_DATE)));
  }

  /** ② 후보 이슈들의 담당자·마감일 변경 이력 — (issue_id, created_at, id) 순. 같은 시각 행도 순서가 흔들리지 않게 id 로 끊는다. */
  public List<HistoryEvent> findHistory(Collection<Long> issueIds) {
    if (issueIds.isEmpty()) return List.of();
    return dsl.select(
            ISSUE_HISTORY.ID,
            ISSUE_HISTORY.ISSUE_ID,
            ISSUE_HISTORY.EVENT_TYPE,
            ISSUE_HISTORY.FROM_VALUE,
            ISSUE_HISTORY.TO_VALUE,
            ISSUE_HISTORY.CREATED_AT)
        .from(ISSUE_HISTORY)
        .where(ISSUE_HISTORY.ISSUE_ID.eq(DSL.any(issueIds.toArray(Long[]::new))))
        .and(ISSUE_HISTORY.EVENT_TYPE.in(ASSIGNEES_CHANGED, DUE_DATE_CHANGED))
        .orderBy(ISSUE_HISTORY.ISSUE_ID, ISSUE_HISTORY.CREATED_AT, ISSUE_HISTORY.ID)
        .fetch(
            r ->
                new HistoryEvent(
                    r.get(ISSUE_HISTORY.ID),
                    r.get(ISSUE_HISTORY.ISSUE_ID),
                    r.get(ISSUE_HISTORY.EVENT_TYPE),
                    r.get(ISSUE_HISTORY.FROM_VALUE),
                    r.get(ISSUE_HISTORY.TO_VALUE),
                    r.get(ISSUE_HISTORY.CREATED_AT)));
  }

  /** ③ 후보 이슈들의 현재 담당자. */
  public List<CurrentAssignee> findCurrentAssignees(Collection<Long> issueIds) {
    if (issueIds.isEmpty()) return List.of();
    return dsl.select(ISSUE_ASSIGNEE.ISSUE_ID, ISSUE_ASSIGNEE.USER_ID)
        .from(ISSUE_ASSIGNEE)
        .where(ISSUE_ASSIGNEE.ISSUE_ID.eq(DSL.any(issueIds.toArray(Long[]::new))))
        .fetch(
            r ->
                new CurrentAssignee(r.get(ISSUE_ASSIGNEE.ISSUE_ID), r.get(ISSUE_ASSIGNEE.USER_ID)));
  }

  /**
   * ④ 후보 이슈별 「AI 가 처음 실제로 일한 시각」 — 「AI와 함께」 (c) 는 그 시각 ≤ closed_at 인가로 판정된다.
   *
   * <p>agent_work.started_at 은 쓰지 않는다 — 담당 배정만으로 SUBMITTED 행이 생기며 그때 now() 로 채워지므로, 한 번도 착수하지 않고 이슈
   * 완료로 CANCELED 된 행(endActiveOnIssueDone)도 「AI가 일함」으로 셌다. 대신 agent_work_event 에서
   * SUBMITTED·CANCELED·REJECTED 가 아닌 상태로 처음 바뀐 시각을 본다. 이벤트가 유일한 근거다 — AgentWorkRepository 의 모든
   * 쓰기(삽입·갱신·종료)가 같은 문장 CTE 로 이벤트를 남겨 행 변경과 함께만 성공하고, 두 테이블이 같은 마이그레이션(V170)에서 생겨 이벤트 없는 작업 행이 없다.
   * 착수 뒤 거절·취소된 작업은 앞선 WORKING 이벤트로 잡힌다.
   *
   * <p>이슈별 MIN 한 문장이다. 작업 행은 V178 {@code agent_work_issue_idx}(issue_id 선두), 이벤트는 {@code
   * agent_work_event_work_idx}(work_id 선두)를 탄다.
   */
  public Map<Long, OffsetDateTime> findFirstAgentRunAt(Collection<Long> issueIds) {
    Map<Long, OffsetDateTime> out = new HashMap<>();
    if (issueIds.isEmpty()) return out;
    Field<OffsetDateTime> first = DSL.min(AGENT_WORK_EVENT.CREATED_AT);
    dsl.select(AGENT_WORK.ISSUE_ID, first)
        .from(AGENT_WORK)
        .join(AGENT_WORK_EVENT)
        .on(AGENT_WORK_EVENT.WORK_ID.eq(AGENT_WORK.ID))
        .where(AGENT_WORK.ISSUE_ID.eq(DSL.any(issueIds.toArray(Long[]::new))))
        .and(AGENT_WORK_EVENT.STATE.notIn(NOT_RUN_STATES))
        .groupBy(AGENT_WORK.ISSUE_ID)
        .forEach(r -> out.put(r.get(AGENT_WORK.ISSUE_ID), r.get(first)));
    return out;
  }

  /**
   * ⑤ 범위 안에서 [from, toExclusive) 에 생긴 이슈의 생성 시각 목록. 상태 무관(취소 포함 — 만든 수). 칸별 묶음은 자바에서 서울 날짜로 한다 — DB
   * 에서 날짜 자르기를 하면 세션 zone 에 따라 칸이 밀린다. 사람 기준은 {@code idx_issue_reporter_created} 를 탄다(V278).
   */
  public List<OffsetDateTime> findCreatedAts(
      Condition scope, OffsetDateTime from, OffsetDateTime toExclusive) {
    return dsl.select(ISSUE.CREATED_AT)
        .from(ISSUE)
        .join(PROJECT)
        .on(PROJECT.ID.eq(ISSUE.PROJECT_ID))
        .where(scope)
        .and(alive())
        .and(ISSUE.CREATED_AT.ge(from))
        .and(ISSUE.CREATED_AT.lt(toExclusive))
        .fetch(ISSUE.CREATED_AT);
  }

  /**
   * 완료·새로 생김 수만 — 현재·지난 기간 넷을 {@code COUNT(*) FILTER} 한 문장으로 센다(WP-1478 개요 숫자 카드). 술어는 {@link
   * #findClosedDone}(DONE·closed_at 구간)·{@link #findCreatedAts}(created_at 구간)와 같고, 구간은 {@link
   * MetricsPeriod} 의 서울 경계라 계산기가 서울 날짜로 기간을 가르는 것과 같은 결과다 — 성과 화면의 「완료 수」와 같은 값이 나온다.
   */
  public MetricsCounts countPeriods(Condition scope, MetricsPeriod period) {
    MetricsPeriod prev = period.previous();
    OffsetDateTime prevFrom = prev.startInclusive();
    OffsetDateTime curFrom = period.startInclusive();
    OffsetDateTime toExclusive = period.endExclusive();
    Condition done = ISSUE.STATUS.eq(IssueStatuses.DONE);
    var completed =
        DSL.count()
            .filterWhere(
                done.and(ISSUE.CLOSED_AT.ge(curFrom)).and(ISSUE.CLOSED_AT.lt(toExclusive)));
    var previousCompleted =
        DSL.count()
            .filterWhere(done.and(ISSUE.CLOSED_AT.ge(prevFrom)).and(ISSUE.CLOSED_AT.lt(curFrom)));
    var created =
        DSL.count().filterWhere(ISSUE.CREATED_AT.ge(curFrom).and(ISSUE.CREATED_AT.lt(toExclusive)));
    var previousCreated =
        DSL.count().filterWhere(ISSUE.CREATED_AT.ge(prevFrom).and(ISSUE.CREATED_AT.lt(curFrom)));
    var r =
        dsl.select(completed, previousCompleted, created, previousCreated)
            .from(ISSUE)
            .join(PROJECT)
            .on(PROJECT.ID.eq(ISSUE.PROJECT_ID))
            .where(scope)
            .and(alive())
            // 두 기간 어느 쪽에도 닿지 않는 행은 처음부터 거른다 — 닫힘·생성 인덱스를 탈 수 있게.
            .and(
                ISSUE
                    .CLOSED_AT
                    .ge(prevFrom)
                    .and(ISSUE.CLOSED_AT.lt(toExclusive))
                    .or(ISSUE.CREATED_AT.ge(prevFrom).and(ISSUE.CREATED_AT.lt(toExclusive))))
            .fetchOne();
    return new MetricsCounts(r.value1(), r.value2(), r.value3(), r.value4());
  }

  /** 사람 기준 「새로 생김」 범위 — 내가 보고자인 이슈. */
  public Condition reportedBy(long userId) {
    return ISSUE.REPORTER_ID.eq(userId);
  }

  /**
   * ⑥ 사람 id 들의 {@code "user".kind} — 이력·현재 담당자에 나오는 사람 전부를 한 번에. 종류는 사람의 속성이라 payload 의 kind 대신 이것만
   * 쓴다.
   */
  public Map<Long, String> findKinds(Collection<Long> userIds) {
    Map<Long, String> out = new HashMap<>();
    if (userIds.isEmpty()) return out;
    dsl.select(USER.ID, USER.KIND)
        .from(USER)
        .where(USER.ID.eq(DSL.any(userIds.toArray(Long[]::new))))
        .forEach(r -> out.put(r.get(USER.ID), r.get(USER.KIND)));
    return out;
  }
}
