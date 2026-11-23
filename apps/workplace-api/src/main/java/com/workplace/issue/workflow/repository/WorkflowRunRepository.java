package com.workplace.issue.workflow.repository;

import static com.workplace.jooq.Tables.ISSUE;
import static com.workplace.jooq.Tables.NODE_RUN;
import static com.workplace.jooq.Tables.WORKFLOW_MOVE_IDEMPOTENCY;
import static com.workplace.jooq.Tables.WORKFLOW_RUN;
import static com.workplace.jooq.Tables.WORKFLOW_RUN_EVENT;
import static com.workplace.jooq.Tables.WORKFLOW_VERSION;
import static org.jooq.impl.DSL.count;
import static org.jooq.impl.DSL.max;
import static org.jooq.impl.DSL.select;

import com.workplace.issue.workflow.domain.RunState;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.Arrays;
import java.util.Collection;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import lombok.RequiredArgsConstructor;
import org.jooq.Condition;
import org.jooq.DSLContext;
import org.jooq.Field;
import org.jooq.JSONB;
import org.jooq.impl.DSL;
import org.springframework.stereotype.Repository;

/**
 * 워크플로우 실행(workflow_run)·노드 방문(node_run)·이벤트·이동 멱등 응답 저장소(WP-1985). 실행 SQL 은 모두 여기에 둔다.
 *
 * <p>테넌트 격리는 RLS 와 tenant_id GUC 기본값이 맡으므로 tenant_id 를 넣지 않는다. 다만 RLS 는 FK 삽입을 막지 않으므로 부모
 * id(이슈·버전·실행)는 부르는 쪽이 권한 확인·잠금을 지난 값만 넘긴다. 트랜잭션·시각·판정은 부르는 쪽(서비스) 몫이고, 저장소는 넘겨받은 시각을 그대로 쓰며 JSON 의
 * 내용은 검사하지 않는다.
 */
@Repository
@RequiredArgsConstructor
public class WorkflowRunRepository {

  /** 활성 실행 상태 — 이슈당 하나만 허용하는 부분 유일 색인의 조건과 같다. */
  private static final List<String> ACTIVE = List.of("RUNNING", "WAITING", "SUSPENDED");

  private final DSLContext dsl;

  /**
   * 실행을 시작한다(revision 0). 이슈에 이미 활성 실행이 있으면 부분 유일 색인 충돌을 {@code ON CONFLICT DO NOTHING} 으로 삼켜 empty
   * 를 돌려준다 — 동시 시작의 경합을 예외 없이 DB 가 가른다. 충돌 대상은 부분 유일 색인뿐이다(나머지 칸에는 유일 제약이 없다).
   */
  public Optional<RunRow> insertRun(
      long issueId,
      long versionId,
      String status,
      String currentNode,
      String contextJson,
      Long startedBy,
      Instant startedAt) {
    return dsl.insertInto(WORKFLOW_RUN)
        .set(WORKFLOW_RUN.ISSUE_ID, issueId)
        .set(WORKFLOW_RUN.WORKFLOW_VERSION_ID, versionId)
        .set(WORKFLOW_RUN.STATUS, status)
        .set(WORKFLOW_RUN.CURRENT_NODE, currentNode)
        .set(WORKFLOW_RUN.CONTEXT, JSONB.valueOf(contextJson))
        .set(WORKFLOW_RUN.STARTED_BY, startedBy)
        .set(WORKFLOW_RUN.STARTED_AT, utc(startedAt))
        .onConflictDoNothing()
        .returning()
        .fetchOptional()
        .map(WorkflowRunRows::toRun);
  }

  /** 이슈의 활성 실행(RUNNING·WAITING·SUSPENDED). 부분 유일 색인 덕에 많아야 하나다. */
  public Optional<RunRow> findActiveByIssue(long issueId) {
    return dsl.selectFrom(WORKFLOW_RUN)
        .where(WORKFLOW_RUN.ISSUE_ID.eq(issueId))
        .and(WORKFLOW_RUN.STATUS.in(ACTIVE))
        .fetchOptional()
        .map(WorkflowRunRows::toRun);
  }

  /**
   * 이슈의 지금 실행 — 활성 실행, 없으면 가장 최근 실행(끝난 것)을 한 번의 질의로 읽는다. 활성 실행은 부분 유일 색인 {@code
   * uq_workflow_run_active_issue}(V333) 로 이슈마다 최대 하나라, 활성 우선 → id 내림차순의 첫 줄이 곧 「활성, 없으면 가장 최근」이다.
   */
  public Optional<RunRow> findCurrentByIssue(long issueId) {
    return dsl.selectFrom(WORKFLOW_RUN)
        .where(WORKFLOW_RUN.ISSUE_ID.eq(issueId))
        .orderBy(
            DSL.when(WORKFLOW_RUN.STATUS.in(ACTIVE), 0).otherwise(1).asc(), WORKFLOW_RUN.ID.desc())
        .limit(1)
        .fetchOptional()
        .map(WorkflowRunRows::toRun);
  }

  /** id 로 실행을 읽는다. 다른 테넌트의 것은 RLS 로 보이지 않는다. */
  public Optional<RunRow> findRun(long id) {
    return dsl.selectFrom(WORKFLOW_RUN)
        .where(WORKFLOW_RUN.ID.eq(id))
        .fetchOptional()
        .map(WorkflowRunRows::toRun);
  }

  /**
   * revision 비교 갱신 — {@code expectedRevision} 과 같을 때만 상태·현재 노드·문맥·끝난 시각을 바꾸고 revision 을 1 올린다. 바뀐
   * 행이 없으면(다른 요청이 먼저 갱신) false 이고 행은 그대로다. 부르는 쪽은 false 를 409 STALE 로 옮긴다.
   */
  public boolean compareAndAdvance(
      long runId,
      int expectedRevision,
      String status,
      String currentNode,
      String contextJson,
      Instant endedAt) {
    return dsl.update(WORKFLOW_RUN)
            .set(WORKFLOW_RUN.STATUS, status)
            .set(WORKFLOW_RUN.CURRENT_NODE, currentNode)
            .set(WORKFLOW_RUN.CONTEXT, JSONB.valueOf(contextJson))
            .set(WORKFLOW_RUN.ENDED_AT, endedAt == null ? null : utc(endedAt))
            .set(WORKFLOW_RUN.REVISION, WORKFLOW_RUN.REVISION.plus(1))
            .where(WORKFLOW_RUN.ID.eq(runId))
            .and(WORKFLOW_RUN.REVISION.eq(expectedRevision))
            .execute()
        == 1;
  }

  /** 노드 방문을 연다(들어간 시각 = {@code enteredAt}). 같은 (실행, 노드, 방문 번호) 나 열린 방문이 둘이면 DB 제약이 막는다. */
  public NodeRunRow insertNodeRun(
      long runId,
      String nodeKey,
      int visitNo,
      String status,
      List<Long> assigneeIds,
      List<Long> workflowAssignedIds,
      boolean viaReturn,
      Instant enteredAt) {
    return WorkflowRunRows.toNodeRun(
        dsl.insertInto(NODE_RUN)
            .set(NODE_RUN.RUN_ID, runId)
            .set(NODE_RUN.NODE_KEY, nodeKey)
            .set(NODE_RUN.VISIT_NO, visitNo)
            .set(NODE_RUN.STATUS, status)
            .set(NODE_RUN.ASSIGNEE_IDS, assigneeIds.toArray(Long[]::new))
            .set(NODE_RUN.WORKFLOW_ASSIGNED_IDS, workflowAssignedIds.toArray(Long[]::new))
            .set(NODE_RUN.VIA_RETURN, viaReturn)
            .set(NODE_RUN.ENTERED_AT, utc(enteredAt))
            .returning()
            .fetchSingle());
  }

  /**
   * 들어가자마자 닫히는 노드 방문 한 줄(자동 노드 통과·end·연쇄 한도 FAILED) — 들어간 시각과 나온 시각이 같다. {@link #insertNodeRun} 뒤
   * {@link #completeNodeRun} 을 부른 것과 칸 값이 같다(결과·출력·의견·행위자는 null). 방문 id 가 이후에 필요 없는 곳에서 쓴다.
   *
   * @param error FAILED 로 닫을 때의 실패 메시지(그 밖에는 null)
   */
  public void insertClosedNodeRun(
      long runId,
      String nodeKey,
      int visitNo,
      String status,
      List<Long> assigneeIds,
      List<Long> workflowAssignedIds,
      boolean viaReturn,
      String error,
      Instant at) {
    dsl.insertInto(NODE_RUN)
        .set(NODE_RUN.RUN_ID, runId)
        .set(NODE_RUN.NODE_KEY, nodeKey)
        .set(NODE_RUN.VISIT_NO, visitNo)
        .set(NODE_RUN.STATUS, status)
        .set(NODE_RUN.ASSIGNEE_IDS, assigneeIds.toArray(Long[]::new))
        .set(NODE_RUN.WORKFLOW_ASSIGNED_IDS, workflowAssignedIds.toArray(Long[]::new))
        .set(NODE_RUN.VIA_RETURN, viaReturn)
        .set(NODE_RUN.ERROR, error)
        .set(NODE_RUN.ENTERED_AT, utc(at))
        .set(NODE_RUN.LEFT_AT, utc(at))
        .execute();
  }

  /**
   * 노드 방문을 닫는다 — 끝 상태·결과·출력·의견 댓글·실패 메시지·행위자·나온 시각을 채운다. 담당 목록은 건드리지 않는다. {@code
   * outputsJson}·{@code commentId}·{@code error}·{@code actorId} 는 없으면 null({@code error} 는 FAILED
   * 로 닫을 때 — 연쇄 한도 초과 기록).
   */
  public void completeNodeRun(
      long nodeRunId,
      String status,
      String outcome,
      String outputsJson,
      Long commentId,
      String error,
      Long actorId,
      Instant leftAt) {
    dsl.update(NODE_RUN)
        .set(NODE_RUN.STATUS, status)
        .set(NODE_RUN.OUTCOME, outcome)
        .set(NODE_RUN.OUTPUTS, outputsJson == null ? null : JSONB.valueOf(outputsJson))
        .set(NODE_RUN.COMMENT_ID, commentId)
        .set(NODE_RUN.ERROR, error)
        .set(NODE_RUN.ACTOR_ID, actorId)
        .set(NODE_RUN.LEFT_AT, utc(leftAt))
        .where(NODE_RUN.ID.eq(nodeRunId))
        .execute();
  }

  /**
   * 열린 노드 방문을 막힘·실패 상태로 바꾼다(WP-1986 — AI 의 차단·실패 보고). 나온 시각(left_at)은 채우지 않는다 — 막힌 방문이 지금 방문으로 남아야
   * 조치(다시 시도 등)가 그 방문을 닫고 이어 간다.
   *
   * @param status BLOCKED 또는 FAILED
   * @param waitingReason 막힌 사유(보고 상태 — BLOCKED·AUTH_REQUIRED). 실패면 null
   * @param error 보고의 note(없으면 null)
   */
  public void blockNodeRun(long nodeRunId, String status, String waitingReason, String error) {
    dsl.update(NODE_RUN)
        .set(NODE_RUN.STATUS, status)
        .set(NODE_RUN.WAITING_REASON, waitingReason)
        .set(NODE_RUN.ERROR, error)
        .where(NODE_RUN.ID.eq(nodeRunId))
        .execute();
  }

  /**
   * 이슈들의 활성 실행을 한 문장으로 CANCELED 로 끝낸다(WP-1986 — 이슈 닫기·삭제). 활성인 것만 바꾸므로 활성 실행이 없는 이슈는 아무 일도 없다.
   * revision 을 1 올린다 — 옛 revision 을 든 이동·조치가 409 STALE 로 걸러지게.
   *
   * <p>잠금: 부르는 쪽(닫힘 경로)이 이미 이슈 행을 갱신한 트랜잭션 안이라 상태 조건부 UPDATE 하나로 충분하다(설계 §9-6).
   *
   * @return 이번에 끝낸 실행(끝난 뒤 모습) — 열린 방문 닫기·이벤트·RunEnded 발행에 쓴다
   */
  public List<RunRow> cancelActiveRunsOfIssues(Collection<Long> issueIds, Instant endedAt) {
    if (issueIds == null || issueIds.isEmpty()) {
      return List.of();
    }
    return dsl.update(WORKFLOW_RUN)
        .set(WORKFLOW_RUN.STATUS, RunState.CANCELED)
        .set(WORKFLOW_RUN.ENDED_AT, utc(endedAt))
        .set(WORKFLOW_RUN.REVISION, WORKFLOW_RUN.REVISION.plus(1))
        .where(WORKFLOW_RUN.ISSUE_ID.in(issueIds))
        .and(WORKFLOW_RUN.STATUS.in(ACTIVE))
        .returning()
        .fetch(WorkflowRunRows::toRun);
  }

  /**
   * 실행 하나를 revision 비교로 CANCELED 로 끝낸다(조치 CANCEL 이 쓴다). 활성이 아니거나 revision 이 다르면 false 이고 행은 그대로다.
   * 끝낸 뒤 열린 방문은 {@link #cancelOpenNodeRuns} 로 닫는다.
   */
  public boolean cancelActiveRun(long runId, int expectedRevision, Instant endedAt) {
    return dsl.update(WORKFLOW_RUN)
            .set(WORKFLOW_RUN.STATUS, RunState.CANCELED)
            .set(WORKFLOW_RUN.ENDED_AT, utc(endedAt))
            .set(WORKFLOW_RUN.REVISION, WORKFLOW_RUN.REVISION.plus(1))
            .where(WORKFLOW_RUN.ID.eq(runId))
            .and(WORKFLOW_RUN.REVISION.eq(expectedRevision))
            .and(WORKFLOW_RUN.STATUS.in(ACTIVE))
            .execute()
        == 1;
  }

  /**
   * 실행들의 열린 방문(나온 시각 없음 — ACTIVE·BLOCKED, 그리고 실패 보고로 FAILED 가 된 막힌 방문)을 CANCELED 로 닫는다(나온 시각 =
   * {@code leftAt}). 막힘·실패 사유(waiting_reason·error)는 지우지 않고 남긴다 — 왜 멈춰 있었는지 기록이 보이게.
   */
  public void cancelOpenNodeRuns(Collection<Long> runIds, Instant leftAt) {
    if (runIds == null || runIds.isEmpty()) {
      return;
    }
    dsl.update(NODE_RUN)
        .set(NODE_RUN.STATUS, RunState.CANCELED)
        .set(NODE_RUN.LEFT_AT, utc(leftAt))
        .where(NODE_RUN.RUN_ID.in(runIds))
        .and(NODE_RUN.LEFT_AT.isNull())
        .execute();
  }

  /** 실행의 노드 방문 전부 — 들어간 순서(id 순). */
  public List<NodeRunRow> findNodeRuns(long runId) {
    return dsl.selectFrom(NODE_RUN)
        .where(NODE_RUN.RUN_ID.eq(runId))
        .orderBy(NODE_RUN.ID)
        .fetch(WorkflowRunRows::toNodeRun);
  }

  /**
   * 열린 실행(RUNNING·WAITING)의 활성 방문(ACTIVE) 전부 — 기다림 타이머(WP-1987)가 오래 머문 방문을 찾는 입력. id 순.
   * SUSPENDED(멈춤) 실행은 사람이 조치할 때까지 기다리는 상태라 타이머 대상이 아니다.
   */
  public List<NodeRunRow> findActiveNodeRunsOfOpenRuns() {
    return dsl.select(NODE_RUN.fields())
        .from(NODE_RUN)
        .join(WORKFLOW_RUN)
        .on(WORKFLOW_RUN.ID.eq(NODE_RUN.RUN_ID))
        .where(NODE_RUN.STATUS.eq("ACTIVE"))
        .and(WORKFLOW_RUN.STATUS.in("RUNNING", "WAITING"))
        // 이미 관리자에게 알린(TIMER_ESCALATE) 방문은 더 할 일이 없어 매 poll 마다 다시 읽지 않는다.
        .andNotExists(
            select(DSL.one())
                .from(WORKFLOW_RUN_EVENT)
                .where(WORKFLOW_RUN_EVENT.RUN_ID.eq(NODE_RUN.RUN_ID))
                .and(WORKFLOW_RUN_EVENT.TYPE.eq("TIMER_ESCALATE"))
                .and(payloadNodeRunId().eq(NODE_RUN.ID.cast(String.class))))
        .orderBy(NODE_RUN.ID)
        .fetchInto(NODE_RUN)
        .map(WorkflowRunRows::toNodeRun);
  }

  /** 타이머 이벤트 payload 의 nodeRunId 글 — SQL 에서 방문과 맞대는 한 곳의 식. */
  private static Field<String> payloadNodeRunId() {
    return DSL.field("{0}->>'nodeRunId'", String.class, WORKFLOW_RUN_EVENT.PAYLOAD);
  }

  /** 실행의 한 종류 이벤트 중 그 방문(nodeRunId)의 것 — 타이머 표시 이벤트 확인용. 없으면 empty. */
  public Optional<RunEventRow> findVisitEvent(long runId, String type, long nodeRunId) {
    return dsl.selectFrom(WORKFLOW_RUN_EVENT)
        .where(WORKFLOW_RUN_EVENT.RUN_ID.eq(runId))
        .and(WORKFLOW_RUN_EVENT.TYPE.eq(type))
        .and(payloadNodeRunId().eq(Long.toString(nodeRunId)))
        .orderBy(WORKFLOW_RUN_EVENT.ID)
        .limit(1)
        .fetchOptional()
        .map(WorkflowRunRows::toEvent);
  }

  /**
   * 열린 실행의 활성 방문을 잠근다 — 타이머가 같은 방문을 동시에 처리하지 않게 하고, 후보 조회 뒤 멈춘(SUSPENDED)·취소·완료된 실행에 알리지 않게
   * 한다(WP-1987 리뷰). 호출자가 아는 runId 로 실행 행을 바로 잠근다. 방문이 그새 ACTIVE 가 아니거나(떠남) 실행이 RUNNING·WAITING 이
   * 아니면 false.
   *
   * <p>두 단계로, 실행 행 → 방문 행 순서로 잠근다(노드 이동·멈춤이 실행 행을 먼저 고치는 순서와 같아 교착이 없다):
   *
   * <ol>
   *   <li>실행 행 FOR SHARE + 상태 조건 — 커밋 안 된 멈춤·취소(실행 행 UPDATE)가 있으면 그 커밋을 기다리고, READ COMMITTED 의
   *       재확인으로 바뀐 상태를 보고 건너뛴다. KEY SHARE 는 키가 아닌 열 UPDATE 와 충돌하지 않아 상태 변경을 기다리지 못하므로 SHARE 를 쓴다.
   *       반대로 이 방문 트랜잭션이 끝날 때까지 그 실행의 이동·멈춤이 기다리지만, 방문 트랜잭션은 이벤트·알림 몇 건이라 짧다.
   *   <li>방문 행 FOR UPDATE + ACTIVE 조건 — 다른 파드의 타이머와 같은 방문을 겹쳐 처리하지 않는다.
   * </ol>
   */
  public boolean lockActiveNodeRunOfOpenRun(long runId, long nodeRunId) {
    boolean runOpen =
        dsl.select(WORKFLOW_RUN.ID)
            .from(WORKFLOW_RUN)
            .where(WORKFLOW_RUN.ID.eq(runId))
            .and(WORKFLOW_RUN.STATUS.in("RUNNING", "WAITING"))
            .forShare()
            .fetchOptional()
            .isPresent();
    if (!runOpen) return false;
    return dsl.select(NODE_RUN.ID)
        .from(NODE_RUN)
        .where(NODE_RUN.ID.eq(nodeRunId))
        .and(NODE_RUN.STATUS.eq("ACTIVE"))
        .forUpdate()
        .fetchOptional()
        .isPresent();
  }

  /** 실행 이벤트를 쌓는다. {@code actorId} 는 시스템이 일으킨 것이면 null. */
  public void insertEvent(long runId, String type, String payloadJson, Long actorId, Instant at) {
    dsl.insertInto(WORKFLOW_RUN_EVENT)
        .set(WORKFLOW_RUN_EVENT.RUN_ID, runId)
        .set(WORKFLOW_RUN_EVENT.TYPE, type)
        .set(WORKFLOW_RUN_EVENT.PAYLOAD, JSONB.valueOf(payloadJson))
        .set(WORKFLOW_RUN_EVENT.ACTOR_ID, actorId)
        .set(WORKFLOW_RUN_EVENT.AT, utc(at))
        .execute();
  }

  /** 실행의 이벤트 전부 — 일어난 순서(id 순). */
  public List<RunEventRow> findEvents(long runId) {
    return dsl.selectFrom(WORKFLOW_RUN_EVENT)
        .where(WORKFLOW_RUN_EVENT.RUN_ID.eq(runId))
        .orderBy(WORKFLOW_RUN_EVENT.ID)
        .fetch(WorkflowRunRows::toEvent);
  }

  /** 실행의 한 종류 이벤트만 — 일어난 순서(id 순). 종류는 SQL 로 걸러 다른 이벤트를 읽지 않는다(WP-1986). */
  public List<RunEventRow> findEvents(long runId, String type) {
    return dsl.selectFrom(WORKFLOW_RUN_EVENT)
        .where(WORKFLOW_RUN_EVENT.RUN_ID.eq(runId))
        .and(WORKFLOW_RUN_EVENT.TYPE.eq(type))
        .orderBy(WORKFLOW_RUN_EVENT.ID)
        .fetch(WorkflowRunRows::toEvent);
  }

  /** 같은 실행·같은 key 로 저장된 첫 응답(없으면 empty). key 는 실행마다 따로다. */
  public Optional<IdempotentRow> findIdempotent(long runId, String key) {
    return dsl.select(WORKFLOW_MOVE_IDEMPOTENCY.ACTOR_ID, WORKFLOW_MOVE_IDEMPOTENCY.RESPONSE)
        .from(WORKFLOW_MOVE_IDEMPOTENCY)
        .where(WORKFLOW_MOVE_IDEMPOTENCY.RUN_ID.eq(runId))
        .and(WORKFLOW_MOVE_IDEMPOTENCY.KEY.eq(key))
        .fetchOptional(r -> new IdempotentRow(r.value1(), r.value2().data()));
  }

  /** 첫 응답을 저장한다. 같은 (실행, key) 가 이미 있으면 덮지 않고 false — 첫 응답이 이긴다. */
  public boolean insertIdempotent(long runId, String key, Long actorId, String responseJson) {
    return dsl.insertInto(WORKFLOW_MOVE_IDEMPOTENCY)
            .set(WORKFLOW_MOVE_IDEMPOTENCY.RUN_ID, runId)
            .set(WORKFLOW_MOVE_IDEMPOTENCY.KEY, key)
            .set(WORKFLOW_MOVE_IDEMPOTENCY.ACTOR_ID, actorId)
            .set(WORKFLOW_MOVE_IDEMPOTENCY.RESPONSE, JSONB.valueOf(responseJson))
            .onConflictDoNothing()
            .execute()
        == 1;
  }

  /**
   * 정의의 실행 목록 한 쪽 — 최신순(id 내림차순), {@code limit} 개까지(WP-1985 설계 §11). 거르기·cursor 는 모두 SQL 에서 해 쪽 크기와
   * cursor 가 어긋나지 않게 한다.
   *
   * <ul>
   *   <li>삭제된 이슈와 정의의 프로젝트 밖 이슈의 실행은 뺀다(호출자가 읽을 수 있음은 정의의 프로젝트로 확인했다 — 이슈는 프로젝트를 옮기지 않는다)
   *   <li>{@code assigneeId} 는 지금 노드 방문(실행의 가장 최근 node_run)의 담당만 본다 — 앞 노드의 담당은 걸리지 않는다
   *   <li>지금 노드 방문은 LEFT JOIN 이라 방문이 없는 실행도 빠지지 않는다
   * </ul>
   *
   * @param status 실행 상태 하나(null 이면 거르지 않음)
   * @param node 지금 노드 키(null 이면 거르지 않음)
   * @param assigneeId 지금 노드 담당(null 이면 거르지 않음)
   * @param beforeId 이 id 보다 작은 실행만(null 이면 처음부터)
   */
  public List<RunListRow> findRunsOfWorkflow(
      long workflowId,
      long projectId,
      String status,
      String node,
      Long assigneeId,
      Long beforeId,
      int limit) {
    var current = NODE_RUN.as("cur");
    var other = NODE_RUN.as("nr");
    Condition where =
        WORKFLOW_VERSION
            .WORKFLOW_ID
            .eq(workflowId)
            .and(ISSUE.PROJECT_ID.eq(projectId))
            .and(ISSUE.DELETED_AT.isNull());
    if (status != null) {
      where = where.and(WORKFLOW_RUN.STATUS.eq(status));
    }
    if (node != null) {
      where = where.and(WORKFLOW_RUN.CURRENT_NODE.eq(node));
    }
    if (assigneeId != null) {
      where = where.and(DSL.val(assigneeId).eq(DSL.any(current.ASSIGNEE_IDS)));
    }
    if (beforeId != null) {
      where = where.and(WORKFLOW_RUN.ID.lt(beforeId));
    }
    return dsl.select(
            WORKFLOW_RUN.ID,
            WORKFLOW_RUN.ISSUE_ID,
            ISSUE.NUMBER,
            ISSUE.TITLE,
            WORKFLOW_RUN.STATUS,
            WORKFLOW_RUN.CURRENT_NODE,
            WORKFLOW_RUN.WORKFLOW_VERSION_ID,
            WORKFLOW_VERSION.VERSION_NO,
            WORKFLOW_RUN.STARTED_AT,
            current.ASSIGNEE_IDS,
            current.ENTERED_AT)
        .from(WORKFLOW_RUN)
        .join(WORKFLOW_VERSION)
        .on(WORKFLOW_VERSION.ID.eq(WORKFLOW_RUN.WORKFLOW_VERSION_ID))
        .join(ISSUE)
        .on(ISSUE.ID.eq(WORKFLOW_RUN.ISSUE_ID))
        .leftJoin(current)
        .on(
            current.ID.eq(
                select(max(other.ID)).from(other).where(other.RUN_ID.eq(WORKFLOW_RUN.ID))))
        .where(where)
        .orderBy(WORKFLOW_RUN.ID.desc())
        .limit(limit)
        .fetch(
            r ->
                new RunListRow(
                    r.value1(),
                    r.value2(),
                    r.value3(),
                    r.value4(),
                    r.value5(),
                    r.value6(),
                    r.value7(),
                    r.value8(),
                    r.value9().toInstant(),
                    r.value10() == null ? List.of() : List.copyOf(Arrays.asList(r.value10())),
                    r.value11() == null ? null : r.value11().toInstant()));
  }

  /**
   * 정의의 버전별 활성 실행 수(버전 id → 수). 활성 실행이 없는 버전은 담지 않는다. 버전 응답의 「남은 실행 수」와 게시의 {@code
   * runningRunsOnOlderVersions} 가 쓴다.
   */
  public Map<Long, Integer> countActiveByVersion(long workflowId) {
    Condition active =
        WORKFLOW_VERSION.WORKFLOW_ID.eq(workflowId).and(WORKFLOW_RUN.STATUS.in(ACTIVE));
    Map<Long, Integer> out = new LinkedHashMap<>();
    dsl.select(WORKFLOW_RUN.WORKFLOW_VERSION_ID, count())
        .from(WORKFLOW_RUN)
        .join(WORKFLOW_VERSION)
        .on(WORKFLOW_VERSION.ID.eq(WORKFLOW_RUN.WORKFLOW_VERSION_ID))
        .where(active)
        .groupBy(WORKFLOW_RUN.WORKFLOW_VERSION_ID)
        .orderBy(WORKFLOW_RUN.WORKFLOW_VERSION_ID)
        .forEach(r -> out.put(r.value1(), r.value2()));
    return out;
  }

  /** Instant 를 DB 시각 칸에 넣을 UTC OffsetDateTime 으로. */
  private static OffsetDateTime utc(Instant at) {
    return OffsetDateTime.ofInstant(at, ZoneOffset.UTC);
  }
}
