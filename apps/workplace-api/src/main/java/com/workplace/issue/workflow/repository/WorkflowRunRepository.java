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

import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.Arrays;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import lombok.RequiredArgsConstructor;
import org.jooq.Condition;
import org.jooq.DSLContext;
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

  /** 실행의 노드 방문 전부 — 들어간 순서(id 순). */
  public List<NodeRunRow> findNodeRuns(long runId) {
    return dsl.selectFrom(NODE_RUN)
        .where(NODE_RUN.RUN_ID.eq(runId))
        .orderBy(NODE_RUN.ID)
        .fetch(WorkflowRunRows::toNodeRun);
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
