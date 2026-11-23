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
import com.workplace.issue.workflow.repository.WorkflowRunRepository;
import com.workplace.project.dto.ProjectRow;
import java.time.Instant;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import lombok.RequiredArgsConstructor;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.stereotype.Component;
import tools.jackson.databind.ObjectMapper;

/**
 * 시작·이동의 후처리(WP-1985, 설계 §9) — 의견 댓글, 이슈 담당, 노드 방문(node_run), 실행 이벤트, 도메인 이벤트를 쓴다. 판정은 하지 않는다(서비스가
 * {@code MoveRules} 로 통과시킨 계획만 받는다).
 *
 * <p>잠금 순서(이슈 → 구성원 → 실행): 댓글(워처 등록이 구성원 행을 잠근다)·담당({@code applyWorkflowChange} 가 구성원 행을 잠근다)을 실행 행
 * 갱신·node_run·이벤트 쓰기(실행 행 FK 로 실행 행을 잠근다)보다 먼저 부른다. 모두 한 트랜잭션이라 설계 §9 의 「실행·node_run → 댓글 → 담당」 순서와
 * 결과는 같다.
 *
 * <p>실행 이벤트 actor_id 규칙: 사람의 요청이 직접 일으킨 RUN_STARTED·MOVED·VISIT_LIMIT 은 요청자를 적고, 요청 안에서 시스템이 이어 만든
 * 자동 단계(AUTO_MOVED·AUTO_LIMIT)와 끝 도달(RUN_COMPLETED)은 null 이다. 상세 화면은 null 을 「자동」으로 읽는다.
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
   * @return 만든 댓글 id(없으면 null)
   */
  Long comment(long actorId, long issueId, String comment) {
    if (comment == null || !PersonNames.hasVisibleChar(comment)) {
      return null;
    }
    return commentService
        .createForWorkflow(actorId, issueId, new CreateCommentRequest(comment))
        .id();
  }

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
      Instant now) {}

  /**
   * 노드에 들어간다 — 지나는 자동 노드는 COMPLETED(entered=left), 머무는 노드는 ACTIVE, end 는 COMPLETED, 한도를 넘었으면 멈춘 자동
   * 노드에 FAILED. 실행 이벤트와 도메인 이벤트도 여기서 낸다(머무는 task 에 NodeEntered, end 에 RunEnded, 방문 한도에
   * VisitLimitReached).
   */
  void enter(Entry e) {
    Map<String, Integer> visits = new HashMap<>();
    Map<String, Integer> forward = new HashMap<>();
    for (NodeRunRow r : e.existing()) {
      visits.merge(r.nodeKey(), 1, Integer::sum);
      if (!r.viaReturn()) {
        forward.merge(r.nodeKey(), 1, Integer::sum);
      }
    }
    long tenantId = TenantContext.get();

    if (e.startKey() != null) {
      passAuto(e, e.startKey(), visits, forward);
    }
    for (Step step : e.route().passed()) {
      passAuto(e, step.nodeKey(), visits, forward);
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
    checkVisitLimit(e, node, viaReturn, forward);
    publisher.publishEvent(
        new WorkflowNodeEntered(
            tenantId, e.runId(), e.issueId(), stop, node.type(), e.stopAssignees()));
  }

  /** 머물지 않는 자동 노드(start·decision) 방문 — COMPLETED 로 들어가고 바로 나온다. */
  private void passAuto(
      Entry e, String key, Map<String, Integer> visits, Map<String, Integer> forward) {
    boolean viaReturn = key.equals(e.returnTo());
    int visitNo = visits.merge(key, 1, Integer::sum);
    runRepository.insertClosedNodeRun(
        e.runId(), key, visitNo, NODE_COMPLETED, List.of(), List.of(), viaReturn, null, e.now());
    checkVisitLimit(e, e.model().nodes().get(key), viaReturn, forward);
  }

  /** 되돌림이 아닌 방문 수(이번 포함)가 maxVisits 이상이면 이동은 그대로 하고 알린다(설계 §10 — 「3 이면 세 번째」). 되돌림 방문은 세지 않는다. */
  private void checkVisitLimit(
      Entry e, Node node, boolean viaReturn, Map<String, Integer> forward) {
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
        e.actorId());
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
