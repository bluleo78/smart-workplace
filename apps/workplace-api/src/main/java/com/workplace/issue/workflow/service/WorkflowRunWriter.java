package com.workplace.issue.workflow.service;

import com.workplace.global.tenant.TenantContext;
import com.workplace.global.util.PersonNames;
import com.workplace.issue.dto.CreateCommentRequest;
import com.workplace.issue.dto.IssueRow;
import com.workplace.issue.outbound.IssueChangeNotifier;
import com.workplace.issue.outbound.WorkflowRunEvents.WorkflowNodeEntered;
import com.workplace.issue.outbound.WorkflowRunEvents.WorkflowRunEnded;
import com.workplace.issue.outbound.WorkflowRunEvents.WorkflowVisitLimitReached;
import com.workplace.issue.service.IssueAssigneeService;
import com.workplace.issue.service.IssueCommentService;
import com.workplace.issue.workflow.domain.RunState;
import com.workplace.issue.workflow.domain.WorkflowModel;
import com.workplace.issue.workflow.domain.WorkflowModel.Node;
import com.workplace.issue.workflow.domain.WorkflowRouting.Route;
import com.workplace.issue.workflow.domain.WorkflowRouting.Step;
import com.workplace.issue.workflow.repository.NodeRunRow;
import com.workplace.issue.workflow.repository.RunEventRow;
import com.workplace.issue.workflow.repository.WorkflowRunRepository;
import com.workplace.project.dto.ProjectRow;
import java.time.Instant;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import lombok.RequiredArgsConstructor;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.stereotype.Component;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

/**
 * 시작·이동의 후처리(WP-1985, 설계 §9) — 의견 댓글, 이슈 담당, 노드 방문(node_run), 실행 이벤트, 도메인 이벤트를 쓴다. 판정은 하지 않는다(서비스가
 * {@code MoveRules} 로 통과시킨 계획만 받는다).
 *
 * <p>잠금 순서(이슈 → 구성원 → 실행): 담당({@code applyWorkflowChange} 가 구성원 행을 잠근다) → 댓글(워처 등록이 구성원 행을 잠근다)을 실행
 * 행 갱신·node_run·이벤트 쓰기(실행 행 FK 로 실행 행을 잠근다)보다 먼저 부른다. 댓글을 담당 뒤에 쓰는 것은 댓글 알림이 쓸 때의 담당에게 가기 때문이다. 설계
 * §9 의 「실행·node_run → 댓글 → 담당」과 순서는 다르지만 한 트랜잭션이라 저장 결과는 같다.
 *
 * <p>실행 이벤트 actor_id 규칙: 사람의 요청이 직접 일으킨 RUN_STARTED·MOVED 와 사람이 직접 들어간(머무는) 노드의 VISIT_LIMIT 은 요청자를
 * 적고, 요청 안에서 시스템이 이어 만든 자동 단계(AUTO_MOVED·AUTO_LIMIT·자동으로 지난 start·decision 의 VISIT_LIMIT)와 끝
 * 도달(RUN_COMPLETED)은 null 이다. 상세 화면은 null 을 「자동」으로 읽는다. 되돌림 한도 알림({@link
 * WorkflowVisitLimitReached})의 행위자는 어느 경우든 이동을 일으킨 사람이다(알림 문구 「님이 넘긴」에 행위자가 필요하다).
 */
@Component
@RequiredArgsConstructor
class WorkflowRunWriter {

  /** 실행 이벤트 type. */
  static final String RUN_STARTED = "RUN_STARTED";

  static final String MOVED = "MOVED";
  static final String AUTO_MOVED = "AUTO_MOVED";
  static final String VISIT_LIMIT = "VISIT_LIMIT";
  static final String AUTO_LIMIT = "AUTO_LIMIT";
  static final String RUN_COMPLETED = "RUN_COMPLETED";

  /**
   * 노드 담당 AI 의 차단(BLOCKED·AUTH_REQUIRED)·실패 보고로 실행이 멈춤(WP-1986). 쓰는 곳은 {@link
   * WorkflowAgentWorkBridge}.
   */
  static final String NODE_BLOCKED = "NODE_BLOCKED";

  static final String NODE_FAILED = "NODE_FAILED";

  /** 이슈 닫기·삭제(WP-1986)나 조치 CANCEL 로 실행이 취소됨. 쓰는 곳은 {@link WorkflowAgentWorkBridge}. */
  static final String RUN_CANCELED = "RUN_CANCELED";

  /**
   * 멈춘 실행의 조치(WP-1986) — 다시 시도(같은 노드 새 방문), onError 로 보냄, 관리자 옮기기(override). 쓰는 곳은 {@link
   * WorkflowRecoveryService}.
   */
  static final String RETRIED = "RETRIED";

  static final String ON_ERROR_MOVED = "ON_ERROR_MOVED";
  static final String OVERRIDE_MOVED = "OVERRIDE_MOVED";

  /** node_run 상태(활성 방문). */
  static final String NODE_COMPLETED = "COMPLETED";

  private final WorkflowRunRepository runRepository;
  private final IssueAssigneeService assigneeService;
  private final IssueCommentService commentService;
  private final IssueChangeNotifier changeNotifier;
  private final ApplicationEventPublisher publisher;
  private final ObjectMapper objectMapper;

  /**
   * 의견을 이슈 댓글로 남긴다. 그려지는 글자가 없으면 의견이 없는 것으로 보고 만들지 않는다(설계 §7 「공백은 없음」) — 의견이 필요한 결과는 이미 {@code
   * MoveRules} 가 422 로 걸렀다.
   *
   * <p>담당 교체({@link #applyAssignees}) 뒤에 부른다 — 댓글 알림(COMMENTED)은 댓글을 쓸 때의 이슈 담당에게 가므로, 먼저 쓰면 빠지는 옛
   * 담당이 받고 새 담당은 받지 못한다.
   *
   * @return 만든 댓글의 id·저장된 본문(첨부 자리 표시를 바꾼 것). 만들지 않았으면 null
   */
  WrittenComment comment(long actorId, long issueId, String comment) {
    if (comment == null || !PersonNames.hasVisibleChar(comment)) {
      return null;
    }
    var saved =
        commentService.createForWorkflow(actorId, issueId, new CreateCommentRequest(comment));
    return new WrittenComment(saved.id(), saved.body());
  }

  /**
   * 저장된 의견 댓글.
   *
   * @param id 댓글 id(node_run.comment_id 로 잇는다)
   * @param body 저장된 본문 — 요청 원문과 달리 file:N 자리 표시가 실제 주소·첨부 이름으로 바뀌어 있다
   */
  record WrittenComment(long id, String body) {}

  /**
   * 이슈 담당을 바꾼다. 바뀌는 것이 없어도 이슈 갱신 알림(SSE)을 한 번 낸다 — 단계 화면을 새로 그리게(설계 §9). 바뀌면 {@code
   * applyWorkflowChange} 가 같은 알림을 한 번 내므로 여기서 또 내지 않는다(이동 하나에 SSE 한 번).
   *
   * <p>add 는 지금 담당이 아닌 사람, remove 는 지금 담당인 사람만 넘긴다(부르는 쪽이 지금 담당 C 로 계산) — 그래서 이 판정이 {@code
   * applyWorkflowChange} 의 실제 diff 와 같고, 둘은 겹치지 않는다.
   */
  void applyAssignees(
      long actorId, ProjectRow project, IssueRow issue, Set<Long> add, Set<Long> remove) {
    if (add.isEmpty() && remove.isEmpty()) {
      changeNotifier.updatedWithoutTouch(project, issue.number(), issue.id(), actorId);
      return;
    }
    assigneeService.applyWorkflowChange(actorId, project, issue, add, remove);
  }

  /**
   * 들어갈 노드들의 계획.
   *
   * @param startKey 시작이면 start 노드 키(COMPLETED 방문으로 먼저 남긴다), 이동이면 null
   * @param returnTo 떠나는 노드의 returnTo — 이 노드로 들어가는 방문은 되돌림(via_return)이다
   * @param stopAssignees 머무는 노드의 담당
   * @param stopWorkflowAssigned 그중 워크플로우가 넣은 사람
   * @param failedAssignees 연쇄 한도를 넘었을 때 FAILED 방문에 옮겨 적을 담당(떠난 노드의 것, 시작이면 매치된 사람)
   * @param failedWorkflowAssigned 위의 workflow_assigned_ids
   * @param notifiedIds 이번 담당 변경({@link #applyAssignees} 의 add)으로 이미 ASSIGNED 알림을 받은 사람 — 진입 이벤트에 실어
   *     깨우기 알림이 겹치지 않게 한다(WP-1986)
   * @param retry 조치 다시 시도(RETRY)의 진입인지 — 참이면 이번 첫 방문(머무는 노드, 연쇄 한도 다시 시도면 첫 자동 노드)을 방문 수에 세지 않는다(설계
   *     §5-5). {@code WorkflowRecoveryService.retry} 만 켠다(코드 리뷰 nit — 방문 순서로 짐작하면 같은 노드로의
   *     onError·옮기기도 다시 시도로 보여 maxVisits 를 피했다)
   */
  record Entry(
      long runId,
      long issueId,
      WorkflowModel model,
      List<NodeRunRow> existing,
      String startKey,
      String returnTo,
      Route route,
      List<Long> stopAssignees,
      List<Long> stopWorkflowAssigned,
      List<Long> failedAssignees,
      List<Long> failedWorkflowAssigned,
      long actorId,
      Instant now,
      Set<Long> notifiedIds,
      boolean retry) {

    /** 다시 시도가 아닌 진입(시작·이동·onError·옮기기). */
    Entry(
        long runId,
        long issueId,
        WorkflowModel model,
        List<NodeRunRow> existing,
        String startKey,
        String returnTo,
        Route route,
        List<Long> stopAssignees,
        List<Long> stopWorkflowAssigned,
        List<Long> failedAssignees,
        List<Long> failedWorkflowAssigned,
        long actorId,
        Instant now,
        Set<Long> notifiedIds) {
      this(
          runId,
          issueId,
          model,
          existing,
          startKey,
          returnTo,
          route,
          stopAssignees,
          stopWorkflowAssigned,
          failedAssignees,
          failedWorkflowAssigned,
          actorId,
          now,
          notifiedIds,
          false);
    }

    /** 이미 알림 받은 사람이 없는 진입(담당 변경 없음) — notifiedIds 가 생기기 전 호출부 호환. */
    Entry(
        long runId,
        long issueId,
        WorkflowModel model,
        List<NodeRunRow> existing,
        String startKey,
        String returnTo,
        Route route,
        List<Long> stopAssignees,
        List<Long> stopWorkflowAssigned,
        List<Long> failedAssignees,
        List<Long> failedWorkflowAssigned,
        long actorId,
        Instant now) {
      this(
          runId,
          issueId,
          model,
          existing,
          startKey,
          returnTo,
          route,
          stopAssignees,
          stopWorkflowAssigned,
          failedAssignees,
          failedWorkflowAssigned,
          actorId,
          now,
          Set.of());
    }
  }

  /**
   * 노드에 들어간다 — 지나는 자동 노드는 COMPLETED(entered=left), 머무는 노드는 ACTIVE, end 는 COMPLETED, 한도를 넘었으면 멈춘 자동
   * 노드에 FAILED. 실행 이벤트와 도메인 이벤트도 여기서 낸다(머무는 task 에 NodeEntered, end 에 RunEnded, 방문 한도에
   * VisitLimitReached).
   */
  void enter(Entry e) {
    Map<String, Integer> visits = new HashMap<>();
    Map<String, Integer> forward = new HashMap<>();
    List<NodeRunRow> existing = e.existing();
    Set<Long> retriedStops = retriedStopVisitIds(e.runId(), existing);
    for (int i = 0; i < existing.size(); i++) {
      NodeRunRow r = existing.get(i);
      visits.merge(r.nodeKey(), 1, Integer::sum);
      if (!r.viaReturn() && !isRetryVisit(r, i == 0 ? null : existing.get(i - 1), retriedStops)) {
        forward.merge(r.nodeKey(), 1, Integer::sum);
      }
    }
    long tenantId = TenantContext.get();

    if (e.startKey() != null) {
      passAuto(e, e.startKey(), visits, forward, false);
    }
    // 다시 시도 표시는 이번 첫 방문에만 — 연쇄 한도 다시 시도는 멈춘 decision 부터 다시 지나므로 첫 자동 노드, 그 밖은 머무는 노드다.
    boolean first = true;
    for (Step step : e.route().passed()) {
      passAuto(e, step.nodeKey(), visits, forward, first && e.retry());
      first = false;
      event(e, AUTO_MOVED, map("from", step.nodeKey(), "to", step.to()), null);
    }

    String stop = e.route().stopNode();
    Node node = e.model().nodes().get(stop);
    boolean viaReturn = stop.equals(e.returnTo());
    int visitNo = visits.merge(stop, 1, Integer::sum);
    if (e.route().limitExceeded()) {
      // 연쇄 한도 초과 — 이슈 담당은 그대로 두고, 조치 뒤 뺄 수 있게 떠난 노드의 담당을 FAILED 방문에 옮겨 적는다(설계 §8).
      runRepository.insertClosedNodeRun(
          e.runId(),
          stop,
          visitNo,
          RunState.NODE_FAILED,
          e.failedAssignees(),
          e.failedWorkflowAssigned(),
          viaReturn,
          "자동 이동이 " + e.route().passed().size() + "단계를 넘어 멈췄습니다. 정의의 decision 연결을 확인해 주세요.",
          e.now());
      event(e, AUTO_LIMIT, map("node", stop, "steps", e.route().passed().size()), null);
      return;
    }
    if ("end".equals(node.type())) {
      runRepository.insertClosedNodeRun(
          e.runId(), stop, visitNo, NODE_COMPLETED, List.of(), List.of(), viaReturn, null, e.now());
      event(e, RUN_COMPLETED, map("node", stop), null);
      publisher.publishEvent(
          new WorkflowRunEnded(tenantId, e.runId(), e.issueId(), RunState.COMPLETED));
      return;
    }
    runRepository.insertNodeRun(
        e.runId(),
        stop,
        visitNo,
        RunState.NODE_ACTIVE,
        e.stopAssignees(),
        e.stopWorkflowAssigned(),
        viaReturn,
        e.now());
    boolean retry = e.route().passed().isEmpty() && e.retry();
    if (!retry) {
      checkVisitLimit(e, node, viaReturn, forward, e.actorId());
    }
    publisher.publishEvent(
        new WorkflowNodeEntered(
            tenantId,
            e.runId(),
            e.issueId(),
            stop,
            node.type(),
            e.stopAssignees(),
            e.actorId(),
            e.notifiedIds()));
  }

  /** 머물지 않는 자동 노드(start·decision) 방문 — COMPLETED 로 들어가고 바로 나온다. */
  private void passAuto(
      Entry e,
      String key,
      Map<String, Integer> visits,
      Map<String, Integer> forward,
      boolean retry) {
    boolean viaReturn = key.equals(e.returnTo());
    int visitNo = visits.merge(key, 1, Integer::sum);
    runRepository.insertClosedNodeRun(
        e.runId(), key, visitNo, NODE_COMPLETED, List.of(), List.of(), viaReturn, null, e.now());
    // 자동 단계라 실행 이벤트의 actor_id 는 null(클래스 Javadoc 규칙). 게시 검증기는 start·decision 에 maxVisits 를 받지 않지만,
    // 저장 모델이 검증을 거치지 않았을 때도 규칙이 어긋나지 않게 둔다.
    if (!retry) {
      checkVisitLimit(e, e.model().nodes().get(key), viaReturn, forward, null);
    }
  }

  /**
   * 지난 방문이 다시 시도(조치 RETRY)로 연 것인지 — 바로 앞 방문이 같은 노드의 멈춘 방문이고, 그 방문이 실행 이벤트 {@code RETRIED} 의
   * nodeRunId 다. 다시 시도는 되돌림이 아니라 방문 수(maxVisits)에 세지 않는다(설계 §5-5). 방문 행에 표시 칸이 없어(마이그레이션 없음) 조치가 남긴
   * 이벤트를 명시 표시로 쓴다 — 방문 순서만으로 짐작하면 같은 노드로의 onError·관리자 옮기기도 다시 시도로 보여 한도를 피했다(코드 리뷰 nit). 조치는 멈춘
   * 방문을 닫자마자 같은 노드의 새 방문을 넣으므로 그 둘은 붙어 있다.
   *
   * @param retriedStops 다시 시도가 닫은 멈춘 방문 id({@link #retriedStopVisitIds})
   */
  static boolean isRetryVisit(NodeRunRow row, NodeRunRow previous, Set<Long> retriedStops) {
    return previous != null
        && retriedStops.contains(previous.id())
        && previous.nodeKey().equals(row.nodeKey());
  }

  /**
   * 다시 시도가 닫은 멈춘 방문 id — 실행 이벤트 {@code RETRIED} 의 nodeRunId. 멈춘(FAILED) 방문이 없으면 다시 시도도 없었으므로 이벤트를
   * 읽지 않고, 읽을 때도 RETRIED 만 SQL 로 걸러 읽는다(이동마다 이벤트 전체를 읽지 않게).
   */
  private Set<Long> retriedStopVisitIds(long runId, List<NodeRunRow> existing) {
    if (existing.stream().noneMatch(r -> RunState.NODE_FAILED.equals(r.status()))) {
      return Set.of();
    }
    Set<Long> ids = new HashSet<>();
    for (RunEventRow ev : runRepository.findEvents(runId, RETRIED)) {
      JsonNode id = objectMapper.readTree(ev.payloadJson()).get("nodeRunId");
      if (id != null && id.isNumber()) {
        ids.add(id.asLong());
      }
    }
    return ids;
  }

  /**
   * 되돌림이 아닌 방문 수(이번 포함)가 maxVisits 이상이면 이동은 그대로 하고 알린다(설계 §10 — 「3 이면 세 번째」). 되돌림 방문은 세지 않는다.
   *
   * @param eventActorId 실행 이벤트 actor_id — 머무는 노드면 요청자, 자동으로 지난 노드면 null. 알림 행위자는 늘 이동을 일으킨 사람
   */
  private void checkVisitLimit(
      Entry e, Node node, boolean viaReturn, Map<String, Integer> forward, Long eventActorId) {
    if (node == null || viaReturn) {
      return;
    }
    int count = forward.merge(node.key(), 1, Integer::sum);
    if (node.maxVisits() == null || count < node.maxVisits()) {
      return;
    }
    event(
        e,
        VISIT_LIMIT,
        map("node", node.key(), "visits", count, "maxVisits", node.maxVisits()),
        eventActorId);
    publisher.publishEvent(
        new WorkflowVisitLimitReached(
            TenantContext.get(), e.runId(), e.issueId(), node.key(), count, e.actorId()));
  }

  /** 실행 이벤트 한 줄. */
  void event(long runId, String type, Map<String, Object> payload, Long actorId, Instant at) {
    runRepository.insertEvent(runId, type, json(payload), actorId, at);
  }

  private void event(Entry e, String type, Map<String, Object> payload, Long actorId) {
    event(e.runId(), type, payload, actorId, e.now());
  }

  /** JSON 글로(응답과 같은 매퍼). */
  String json(Object value) {
    return objectMapper.writeValueAsString(value);
  }

  /** 순서를 지킨 이벤트 내용 맵(키·값 번갈아). */
  static Map<String, Object> map(Object... pairs) {
    Map<String, Object> m = new LinkedHashMap<>();
    for (int i = 0; i < pairs.length; i += 2) {
      m.put((String) pairs[i], pairs[i + 1]);
    }
    return m;
  }
}
