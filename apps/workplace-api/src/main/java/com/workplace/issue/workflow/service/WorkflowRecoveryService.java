package com.workplace.issue.workflow.service;

import com.workplace.issue.dto.IssueRow;
import com.workplace.issue.dto.IssueStatuses;
import com.workplace.issue.exception.IssueNotFoundException;
import com.workplace.issue.repository.IssueRepository;
import com.workplace.issue.workflow.domain.AssigneeResolution;
import com.workplace.issue.workflow.domain.MoveRules;
import com.workplace.issue.workflow.domain.MoveRules.MovePlan;
import com.workplace.issue.workflow.domain.MoveViolation;
import com.workplace.issue.workflow.domain.NodeTypes;
import com.workplace.issue.workflow.domain.ReservedOutcomes;
import com.workplace.issue.workflow.domain.RunState;
import com.workplace.issue.workflow.domain.WorkflowModel;
import com.workplace.issue.workflow.domain.WorkflowModel.Node;
import com.workplace.issue.workflow.domain.WorkflowModel.Outcome;
import com.workplace.issue.workflow.domain.WorkflowRouting.Route;
import com.workplace.issue.workflow.dto.IssueWorkflowView;
import com.workplace.issue.workflow.dto.MoveRequest;
import com.workplace.issue.workflow.dto.RecoverRequest;
import com.workplace.issue.workflow.dto.RecoverRequest.Action;
import com.workplace.issue.workflow.exception.WorkflowException;
import com.workplace.issue.workflow.repository.NodeRunRow;
import com.workplace.issue.workflow.repository.RunRow;
import com.workplace.issue.workflow.repository.WorkflowRunRepository;
import com.workplace.issue.workflow.service.WorkflowRunService.AssigneeDiff;
import com.workplace.issue.workflow.service.WorkflowRunViews.Snapshot;
import com.workplace.issue.workflow.service.WorkflowRunWriter.WrittenComment;
import com.workplace.project.dto.ProjectRow;
import java.time.Instant;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * 멈춘(SUSPENDED) 워크플로우 실행의 조치(WP-1986, 설계 §5-5·§9-5) — 다시 시도·onError 로 보냄·관리자 옮기기·실행 취소.
 *
 * <p>실행이 멈추는 것은 노드 담당 AI 의 차단·실패 보고(node_run BLOCKED·FAILED)나 자동 연쇄 한도(멈춘 decision 의 FAILED 방문)뿐이고,
 * 멈춘 실행은 노드 이동을 받지 않는다(WORKFLOW_NODE_SUSPENDED). 사람이 이 조치로 실행을 다시 움직이거나 끝낸다.
 *
 * <p>순서는 이동과 같다: 이슈 읽기(404) → 쓰기 권한(403) → 이슈 행 잠금 → 판정 → 쓰기. 잠금 순서(이슈 → 구성원 → 실행)도 같아 담당 변경 → 의견
 * 댓글을 실행 행 revision 갱신·node_run·이벤트보다 먼저 쓴다. 진입·자동 통과·떠남·담당 계산은 이동의 것({@link
 * WorkflowRunWriter#enter}· {@link MoveRules#plan}·{@link WorkflowRunService#assigneeDiff})을 다시
 * 쓴다(원장 R1 — 규칙을 두 곳에 쓰지 않는다). AI 작업은 이동처럼 진입 이벤트와 다리({@link WorkflowAgentWorkBridge})가 맞춘다.
 *
 * <p>멱등 key 는 받지 않는다 — 조치가 끝나면 실행이 SUSPENDED 를 벗어나거나 revision 이 올라, 같은 요청의 재시도는 409 로 막힌다.
 */
@Service
@Transactional
@RequiredArgsConstructor
public class WorkflowRecoveryService {

  /** 조치가 만든 가짜 결과의 키 — 판정 함수가 결과를 요구해서 쓰고, 저장하지 않는다. */
  private static final String RECOVER_OUTCOME = ReservedOutcomes.RECOVER;

  /** 조치 CANCEL 의 취소 사유(이슈 닫힘의 ISSUE_CLOSED 와 가른다). */
  private static final String CANCEL_REASON = "RECOVER";

  private final IssueRepository issueRepository;
  private final WorkflowRunService runService;
  private final WorkflowRunRepository runRepository;
  private final WorkflowRunWriter writer;
  private final WorkflowRunViews views;
  private final WorkflowAgentWorkBridge agentWorkBridge;

  /**
   * 조치 하나를 한다. 공통 거절: 활성 실행 없음·이슈 닫힘 409 NOT_ACTIVE, revision 다름 409 STALE(지금 revision 을 싣는다), 멈추지
   * 않음 409 NOT_SUSPENDED, MOVE_TO 를 관리자가 아닌 사람이 하면 403 NOT_MANAGER. 권한은 이동과 같은 이슈 쓰기(프로젝트 구성원)이고
   * MOVE_TO 만 관리자(OWNER·ADMIN + project:manage)다.
   *
   * @return 조치 뒤 실행 view
   */
  public IssueWorkflowView recover(long issueId, RecoverRequest req, long actorId) {
    // 1. 이슈 읽기(404)·쓰기(403) → 이슈 행 잠금
    IssueRow seen = issueRepository.findById(issueId).orElseThrow(IssueNotFoundException::new);
    ProjectRow project = runService.writableProject(seen, actorId);
    IssueRow issue =
        issueRepository
            .findActiveByIdForNoKeyUpdate(seen.id())
            .orElseThrow(IssueNotFoundException::new);

    // 2. 공통 판정 — 활성 실행 → revision → 멈춤 → 관리자(이동의 판정 순서와 같게 revision 을 권한보다 먼저 본다)
    RunRow run =
        runRepository
            .findActiveByIssue(issue.id())
            .filter(r -> !IssueStatuses.isClosed(issue.status()))
            .orElseThrow(() -> WorkflowException.fromViolation(MoveViolation.notActive()));
    if (req.expectedRevision() != run.revision()) {
      throw runService.staleNow(run);
    }
    Snapshot before = runService.snapshot(project, issue, run);
    RunState state = WorkflowRunViews.stateOf(before);
    if (!state.isSuspended()) {
      throw WorkflowException.notSuspended();
    }
    if (req.action() == Action.MOVE_TO && !runService.isManager(project, actorId)) {
      throw WorkflowException.notManager();
    }
    NodeRunRow visit = WorkflowRunViews.currentVisit(before);
    Node node = before.model().nodes().get(run.currentNode());
    if (visit == null || node == null) {
      // 멈춘 실행에는 지금 방문이 늘 있다 — 없으면 저장 상태가 깨진 것이라 조치하지 않는다.
      throw WorkflowException.fromViolation(MoveViolation.notActive());
    }

    Context ctx = new Context(project, issue, run, before, state, visit, node, actorId);
    switch (req.action()) {
      case RETRY -> retry(ctx, req.comment());
      case ON_ERROR -> onError(ctx, req.comment());
      case MOVE_TO -> moveTo(ctx, req.toNode(), req.comment());
      case CANCEL -> cancel(ctx, req.comment());
    }
    return views.build(
        runService.snapshot(issue, runRepository.findRun(run.id()).orElseThrow(), before));
  }

  /** 한 조치 요청에서 읽은 것 — 조치마다 같은 인자를 길게 넘기지 않게 묶는다. */
  private record Context(
      ProjectRow project,
      IssueRow issue,
      RunRow run,
      Snapshot before,
      RunState state,
      NodeRunRow visit,
      Node node,
      long actorId) {}

  // ───────────────────────── 다시 시도 ─────────────────────────

  /**
   * RETRY — 지금 방문은 FAILED 로 닫고(left_at, 사유 유지 — {@link #closeVisit}), 같은 노드에 새 방문을 연다. 진입은 이동과 같은
   * {@link WorkflowRunWriter#enter} 라 진입 이벤트로 다리가 노드 AI 를 SUBMITTED 로 되돌리고(막힌 행) 또는 새로 열고(끝난 FAILED
   * 행) 다시 깨운다. 실행 상태는 노드 종류대로(RUNNING·WAITING)다.
   *
   * <p>담당: 멈춘 방문의 담당 ∩ 지금 이슈 담당으로 다시 들어간다 — 멈춘 동안 이슈에서 빠진 사람은 다시 넣지도 깨우지도 않는다. 남는 사람이 없으면 422
   * {@code WORKFLOW_ASSIGNEE_REQUIRED}(아무것도 쓰지 않는다).
   *
   * <p>방문 수: 다시 시도는 되돌림이 아니라 maxVisits 에 세지 않는다(설계 §5-5) — 진입에 다시 시도 표시(Entry.retry)를 켜 이번 방문을 빼고,
   * 다음 진입부터는 이벤트 RETRIED 의 nodeRunId(닫은 멈춘 방문)로 그 뒤 방문을 다시 시도로 알아본다({@link
   * WorkflowRunWriter#isRetryVisit}). 이 표시는 여기서만 켠다 — 같은 노드로의 onError·옮기기는 방문 수에 센다. 방문
   * 번호(visit_no)는 그대로 하나 오른다.
   *
   * <p>연쇄 한도로 멈춘 실행(지금 노드가 decision 이고 그 방문이 FAILED)은 그 decision 부터 새 연쇄 계수로 다시 지난다(설계 §9-5) —
   * onError 와 같은 옮기기 경로를 쓴다.
   */
  private void retry(Context c, String comment) {
    if (!NodeTypes.isTask(c.node())) {
      // 연쇄를 멈추게 한 이동의 assignTo 는 남아 있지 않다 — 생략(지금 방문 담당 기준)으로 보고, 못 정하면 도착 노드 역할에서 고른다.
      relocate(
          c,
          withRoleFallback(c, new Outcome(RECOVER_OUTCOME, c.node().key(), null, false, null)),
          comment,
          WorkflowRunWriter.RETRIED);
      return;
    }
    WorkflowModel model = c.before().model();
    Route route = new Route(List.of(), c.node().key(), false);
    // 담당은 멈춘 방문의 담당 중 지금도 이슈 담당인 사람만 — 멈춘 동안 사람이 이슈에서 뺀 AI 를 다시 넣거나 깨우지 않는다(최종 리뷰 I2). 이동의
    // assigneeDiff 는 N − C 를 다시 넣으므로 여기서는 쓰지 않는다(뺀 AI 가 되돌아온다).
    Set<Long> current = new HashSet<>(c.before().issueAssignees());
    List<Long> stay = retainCurrent(c.visit().assigneeIds(), current);
    List<Long> stayWorkflowAssigned = retainCurrent(c.visit().workflowAssignedIds(), current);
    if (stay.isEmpty() && !c.visit().assigneeIds().isEmpty()) {
      // 맡을 사람이 모두 빠졌다 — 역할에서 다시 고르면 대개 방금 뺀 그 사람이라 고르지 않는다. 쓰기 전에 거절해 아무것도 바뀌지 않고, ON_ERROR·
      // 관리자 옮기기·취소로 조치하거나 담당을 다시 넣은 뒤 다시 시도한다.
      throw WorkflowException.fromViolation(
          MoveViolation.assigneeRequired(
              c.node().roleKey(),
              "",
              "멈춘 단계의 담당이 모두 이슈에서 빠져 다시 시도할 사람이 없습니다. 담당을 다시 넣거나 다른 조치를 골라 주세요."));
    }
    Instant now = WorkflowRunService.now();
    // 이슈 담당은 바꾸지 않는다(남은 사람은 이미 담당이다) — 바뀌는 것이 없어도 단계 화면을 새로 그리게 갱신 알림을 낸다.
    writer.applyAssignees(c.actorId(), c.project(), c.issue(), Set.of(), Set.of());
    Long commentId = commentId(c, comment);
    advance(
        c, WorkflowRunService.statusOf(model, route), route.stopNode(), c.run().contextJson(), now);
    closeVisit(c, commentId, now);
    writer.event(
        c.run().id(),
        WorkflowRunWriter.RETRIED,
        WorkflowRunWriter.map(
            "node", c.node().key(), "nodeRunId", c.visit().id(), "commentId", commentId),
        c.actorId(),
        now);
    writer.enter(
        new WorkflowRunWriter.Entry(
            c.run().id(),
            c.issue().id(),
            model,
            c.before().nodeRuns(),
            null,
            null,
            route,
            stay,
            stayWorkflowAssigned,
            c.visit().assigneeIds(),
            c.visit().workflowAssignedIds(),
            c.actorId(),
            now,
            Set.of(),
            true));
  }

  /** ids 중 지금 이슈 담당인 사람만(순서 유지). */
  private static List<Long> retainCurrent(List<Long> ids, Set<Long> current) {
    return ids.stream().filter(current::contains).toList();
  }

  // ───────────────────────── onError ─────────────────────────

  /** ON_ERROR — 노드의 {@code onError} 로 이동한다(assignTo 적용). 정의가 없으면 422 NO_ON_ERROR. */
  private void onError(Context c, String comment) {
    WorkflowModel.Target target = c.node().onError();
    if (target == null || target.to() == null) {
      throw WorkflowException.noOnError();
    }
    relocate(
        c,
        new Outcome(RECOVER_OUTCOME, target.to(), target.assignTo(), false, null),
        comment,
        WorkflowRunWriter.ON_ERROR_MOVED);
  }

  // ───────────────────────── 관리자 옮기기 ─────────────────────────

  /**
   * MOVE_TO — 간선·조건·방문 규칙을 건너뛰어(override) 대상 노드로 옮긴다(설계 §9-5). 대상은 모델에 있는 노드이고 start 는 안 된다. 담당은 그
   * 노드에 마지막으로 머문 사람(keep)을 먼저, 없으면 그 노드 역할에서 정한다(한 명이면 그 사람). end 면 실행이 보통처럼 끝난다.
   */
  private void moveTo(Context c, String toNode, String comment) {
    if (toNode == null || toNode.isBlank()) {
      throw WorkflowException.recoverTargetInvalid(true);
    }
    Node target = c.before().model().nodes().get(toNode);
    if (target == null || NodeTypes.START.equals(target.type())) {
      throw WorkflowException.recoverTargetInvalid(false);
    }
    // 대상에 머문 적이 없어 keep 기준이 비면 대상 역할에서 고른다.
    Outcome keep = new Outcome(RECOVER_OUTCOME, toNode, AssigneeResolution.KEEP, false, null);
    relocate(c, withRoleFallback(c, keep), comment, WorkflowRunWriter.OVERRIDE_MOVED);
  }

  /**
   * 조치가 만든 결과로 담당을 정하지 못하면(위반) 머무는 노드의 역할을 assignTo 로 바꾼 결과를 돌려준다 — 역할에 한 명이면 그 사람이 된다. 머무는 노드에 역할이
   * 없거나(end·한도) 처음부터 정해지면 그대로 둔다. 바꿔도 못 정하면 relocate 가 그 위반(422)을 그대로 낸다.
   */
  private static Outcome withRoleFallback(Context c, Outcome first) {
    MovePlan plan = plan(c, first);
    if (plan.resolution().violation() == null) {
      return first;
    }
    Node stop = c.before().model().nodes().get(plan.route().stopNode());
    if (stop == null || stop.roleKey() == null) {
      return first;
    }
    return new Outcome(first.key(), first.to(), stop.roleKey(), false, null);
  }

  // ───────────────────────── 취소 ─────────────────────────

  /**
   * CANCEL — 실행 CANCELED(revision 비교 갱신), 열린 방문 CANCELED, 이벤트 RUN_CANCELED·{@code
   * WorkflowRunEnded}(CANCELED) 는 이슈 닫힘과 같은 모양({@link WorkflowAgentWorkBridge#recordRunCanceled}),
   * 지금 노드 담당 AI 의 작업 CANCELED. 아무도 깨우지 않는다.
   */
  private void cancel(Context c, String comment) {
    Instant now = WorkflowRunService.now();
    writer.applyAssignees(c.actorId(), c.project(), c.issue(), Set.of(), Set.of());
    commentId(c, comment);
    if (!runRepository.cancelActiveRun(c.run().id(), c.run().revision(), now)) {
      throw runService.staleNow(c.run());
    }
    runRepository.cancelOpenNodeRuns(List.of(c.run().id()), now);
    agentWorkBridge.recordRunCanceled(
        c.run().id(), c.issue().id(), c.node().key(), CANCEL_REASON, c.actorId(), now);
    agentWorkBridge.cancelNodeAgents(c.issue().id(), c.visit().assigneeIds());
  }

  // ───────────────────────── 공통 ─────────────────────────

  /**
   * 지금 노드를 떠나 outcome.to 로 옮긴다 — 이동과 같은 계획(연쇄·담당)·담당 변경·의견·revision 갱신·진입을 쓰고, 멈춘 방문은 FAILED 로
   * 닫는다({@link #closeVisit}). 떠난 노드가 agent_task 면 그 AI 의 작업은 COMPLETED(이동처럼 {@code
   * onNodeLeft(asked=false)}).
   *
   * @param eventType 남길 이벤트 — 관리자 옮기기(OVERRIDE_MOVED)면 내용에 행위자를 적고(「관리자 override」 기록), 연쇄 한도 다시
   *     시도(RETRIED)면 다시 시도 진입으로 들어간다
   */
  private void relocate(Context c, Outcome outcome, String comment, String eventType) {
    WorkflowModel model = c.before().model();
    MovePlan plan = plan(c, outcome);
    if (plan.resolution().violation() != null) {
      throw WorkflowException.fromViolation(plan.resolution().violation());
    }
    Route route = plan.route();
    List<Long> next = plan.resolution().assignees();
    NodeRunRow leaving = c.visit();
    AssigneeDiff diff =
        WorkflowRunService.assigneeDiff(
            c.before().issueAssignees(),
            leaving.workflowAssignedIds(),
            next,
            route.limitExceeded());
    Instant now = WorkflowRunService.now();
    // 연쇄 한도로 멈춘 실행의 다시 시도(RETRY)만 다시 시도 진입이다 — onError·관리자 옮기기는 같은 노드로 가도 방문 수에 센다(코드 리뷰 nit).
    boolean retry = WorkflowRunWriter.RETRIED.equals(eventType);

    writer.applyAssignees(c.actorId(), c.project(), c.issue(), diff.add(), diff.remove());
    Long commentId = commentId(c, comment);
    advance(
        c,
        WorkflowRunService.statusOf(model, route),
        route.stopNode(),
        writer.json(plan.context()),
        now);
    closeVisit(c, commentId, now);
    Map<String, Object> payload =
        WorkflowRunWriter.map(
            "from", c.node().key(),
            "to", outcome.to(),
            "added", List.copyOf(diff.add()),
            "removed", List.copyOf(diff.remove()),
            "commentId", commentId);
    if (WorkflowRunWriter.OVERRIDE_MOVED.equals(eventType)) {
      // 관리자 옮기기는 누가 규칙을 건너뛰었는지 내용에도 남긴다(payload 는 jsonb 라 키 순서는 저장되지 않는다).
      payload.put("actor", c.actorId());
    }
    if (retry) {
      // 다음 진입이 이 다시 시도의 방문을 알아보게 닫은 멈춘 방문을 남긴다(task 다시 시도의 RETRIED 와 같은 칸).
      payload.put("nodeRunId", leaving.id());
    }
    writer.event(c.run().id(), eventType, payload, c.actorId(), now);
    // 이동과 같은 순서 — 반복 회수 → 떠난 노드의 AI 작업 닫기 → 다음 노드 진입(같은 AI 가 다음 노드도 맡으면 닫은 뒤에 새 SUBMITTED 를 연다).
    agentWorkBridge.retireRemovedAgents(c.issue().id(), diff.remove());
    if (NodeTypes.AGENT_TASK.equals(c.node().type())) {
      agentWorkBridge.onNodeLeft(c.issue().id(), leaving.assigneeIds(), false);
    }
    writer.enter(
        new WorkflowRunWriter.Entry(
            c.run().id(),
            c.issue().id(),
            model,
            c.before().nodeRuns(),
            null,
            c.node().returnTo(),
            route,
            next,
            diff.nextWorkflowAssigned(),
            leaving.assigneeIds(),
            leaving.workflowAssignedIds(),
            c.actorId(),
            now,
            Set.copyOf(diff.add()),
            retry));
  }

  /**
   * 이동과 같은 계획(연쇄·담당) — 조치는 결과 선택·출력·담당 지정이 없어 그 칸을 비운 요청으로 판정 함수를 부른다. {@link MoveRules#check} 는
   * 부르지 않는다(멈춘 실행을 거절하는 판정이라).
   */
  private static MovePlan plan(Context c, Outcome outcome) {
    MoveRequest probe =
        new MoveRequest(
            c.node().key(), outcome.key(), null, null, null, c.run().revision(), RECOVER_OUTCOME);
    return MoveRules.plan(c.node(), outcome, probe, c.state(), c.before().members());
  }

  /** 의견을 이동 의견과 같은 경로로 이슈 댓글로 남긴다. 만들지 않았으면 null. */
  private Long commentId(Context c, String comment) {
    WrittenComment written = writer.comment(c.actorId(), c.issue().id(), comment);
    return written == null ? null : written.id();
  }

  /** 실행 행 revision 비교 갱신 — 이슈 행을 잠근 뒤라 일어나지 않아야 하지만, 0 행이면 지금 값을 실은 STALE 로 전체를 되돌린다. */
  private void advance(Context c, String status, String node, String contextJson, Instant now) {
    if (!runRepository.compareAndAdvance(
        c.run().id(),
        c.run().revision(),
        status,
        node,
        contextJson,
        RunState.COMPLETED.equals(status) ? now : null)) {
      throw runService.staleNow(c.run());
    }
  }

  /**
   * 멈춘 방문을 닫는다(left_at·행위자·의견). FAILED 는 그대로, BLOCKED 는 FAILED 로 닫는다. 연쇄 한도의 FAILED 방문처럼 이미 닫힌 것은
   * 건드리지 않는다.
   *
   * <p>왜 BLOCKED 를 FAILED 로: V334 에서 ACTIVE·BLOCKED 는 진행 중, COMPLETED·FAILED·CANCELED 는 끝난 상태이고, 열린
   * 방문 유일 색인({@code uq_node_run_open} — 실행당 ACTIVE·BLOCKED 하나)이 left_at 이 아니라 이 상태로 판정한다. 닫은 방문을
   * BLOCKED 로 두면 여전히 열린 방문으로 세어 다음 ACTIVE 방문을 넣지 못한다(마이그레이션 없이 끝난 상태로 둔다). 처음 막힘은 지워지지 않는다 —
   * waiting_reason (BLOCKED·AUTH_REQUIRED)·error 는 이 갱신이 그대로 두고, 실행 이벤트 NODE_BLOCKED 가 남아 있다.
   */
  private void closeVisit(Context c, Long commentId, Instant now) {
    NodeRunRow v = c.visit();
    if (v.leftAt() != null) {
      return;
    }
    String closed = RunState.NODE_BLOCKED.equals(v.status()) ? RunState.NODE_FAILED : v.status();
    runRepository.completeNodeRun(
        v.id(), closed, v.outcome(), v.outputsJson(), commentId, v.error(), c.actorId(), now);
  }
}
