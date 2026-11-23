package com.workplace.issue.workflow.service;

import com.workplace.global.tenant.TenantContext;
import com.workplace.issue.dto.AgentWorkState;
import com.workplace.issue.dto.IssueRow;
import com.workplace.issue.outbound.WorkflowRunEvents.WorkflowNodeEntered;
import com.workplace.issue.outbound.WorkflowRunEvents.WorkflowNodeWakeEvent;
import com.workplace.issue.outbound.WorkflowRunEvents.WorkflowRunEnded;
import com.workplace.issue.repository.AgentWorkRepository;
import com.workplace.issue.repository.AgentWorkRepository.AgentWorkRow;
import com.workplace.issue.repository.IssueAssigneeRepository;
import com.workplace.issue.repository.IssueRepository;
import com.workplace.issue.service.AgentWorkService;
import com.workplace.issue.workflow.domain.ActiveMember;
import com.workplace.issue.workflow.domain.MoveActor;
import com.workplace.issue.workflow.domain.MoveViolation;
import com.workplace.issue.workflow.domain.NodeTypes;
import com.workplace.issue.workflow.domain.RunRoleMembers;
import com.workplace.issue.workflow.domain.RunState;
import com.workplace.issue.workflow.domain.WorkflowModel;
import com.workplace.issue.workflow.domain.WorkflowModel.Node;
import com.workplace.issue.workflow.domain.WorkflowRouting;
import com.workplace.issue.workflow.exception.WorkflowException;
import com.workplace.issue.workflow.repository.NodeRunRow;
import com.workplace.issue.workflow.repository.RunRow;
import com.workplace.issue.workflow.repository.WorkflowRepository;
import com.workplace.issue.workflow.repository.WorkflowRunRepository;
import com.workplace.user.dto.AssigneeInfo;
import com.workplace.user.repository.UserRepository;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.Collection;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;
import lombok.RequiredArgsConstructor;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.context.event.EventListener;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.databind.ObjectMapper;

/**
 * 워크플로우 실행 ↔ AI 작업(agent_work)·깨우기 다리(WP-1986, 설계 §5-1). 실행 엔진({@link WorkflowRunWriter})은
 * agent_work 를 모른다 — 엔진이 내는 {@link WorkflowNodeEntered} 를 이 다리가 같은 트랜잭션의 동기 리스너로 받아 AI 작업을 열고, 노드
 * 떠남은 실행 서비스가 {@link #onNodeLeft} 로 직접 부른다(떠난 node_run·질문 여부는 이벤트에 없다). 실행·node_run·agent_work 가 한
 * 트랜잭션에서 바뀌고, 깨우기만 전용 이벤트({@link WorkflowNodeWakeEvent})의 커밋 뒤 소비자(내부 AI → 그 AI 를 실행 주체로 고정한
 * ai-agent 발사, 외부 AI → ASSIGNED 알림)가 한다.
 *
 * <p>왜 담당 지정 이벤트를 다시 쓰지 않나: 그 발사는 행위자가 AI 면 건너뛰고 이슈 담당 중 첫 내부 AI 를 골라, AI 가 다음 노드의 AI 에게 넘길 때 깨워야 할
 * AI 를 못 깨웠고, 이동이 새로 넣은 AI 는 ASSIGNED 알림을 두 번 받았다(리뷰 I1·I2).
 *
 * <p>왜 담당 지정 서비스에 의존하지 않나: 담당 지정 서비스가 이 다리의 판정 메서드를 부르게 되므로(담당 지정 깨우기 억제) 반대 방향 의존은 생성자 순환이다.
 */
@Service
@Transactional
@RequiredArgsConstructor
public class WorkflowAgentWorkBridge {

  /**
   * 노드 담당 AI 가 보고로 바꿀 수 없고 노드 이동으로 해야 하는 상태(원장 R9). 질문·검토는 이동의 결과이고, 완료·취소·반려로 작업만 끝내면 실행은
   * RUNNING·노드는 ACTIVE 인데 일하는 작업이 없어(조치도 멈춘 실행만 받는다) 실행이 조용히 멈춘다 — 노드를 끝내는 길을 이동 하나로 둬 실행과 작업이 어긋나지
   * 않게 한다. 실패는 여기 없다 — 실행을 멈춰(SUSPENDED) 조치로 잇는다.
   */
  private static final Set<String> USE_MOVE_STATES =
      Set.of(
          AgentWorkState.INPUT_REQUIRED,
          AgentWorkState.REVIEW,
          AgentWorkState.COMPLETED,
          AgentWorkState.CANCELED,
          AgentWorkState.REJECTED);

  private final AgentWorkService agentWorkService;
  private final AgentWorkRepository agentWorkRepository;
  private final IssueRepository issueRepository;
  private final UserRepository userRepository;
  private final WorkflowRepository workflowRepository;
  private final WorkflowRunRepository runRepository;
  private final IssueAssigneeRepository assigneeRepository;
  private final WorkflowModelLoader modelLoader;
  private final WorkflowMemberLookup memberLookup;
  private final ApplicationEventPublisher publisher;
  private final ObjectMapper objectMapper;

  /**
   * 머무는 노드 진입 — agent_task 이면 노드 담당 중 AI 를 깨운다. human_task 는 agent_work 를 만들지 않는다(사람 할 일은 다른 이슈의
   * 몫).
   *
   * <ul>
   *   <li>외부 AI: 진행 중 행이 없으면 SUBMITTED 를 연다({@code submitForAssignees}, 멱등). 이미 있으면(질문 뒤 답으로 돌아옴 —
   *       INPUT_REQUIRED) 그 행을 SUBMITTED 로 되돌린다 — 같은 AI 를 다시 깨우는 것이다
   *   <li>내부 AI: SUBMITTED 를 만들지 않는다(지금 규칙 — 내부 AI 는 서버 실행기가 보고한다). 깨우기만 한다
   *   <li>깨우기: 노드의 AI 담당 전원·진입을 일으킨 사람·이번 담당 변경으로 이미 알림 받은 사람을 실은 {@link WorkflowNodeWakeEvent}
   * </ul>
   *
   * AI 담당이 없는 노드면 아무것도 쓰지도 내지도 않는다(사람만의 흐름은 WP-1985 그대로).
   */
  @EventListener
  public void onNodeEntered(WorkflowNodeEntered e) {
    if (!NodeTypes.AGENT_TASK.equals(e.nodeType()) || e.assigneeIds().isEmpty()) {
      return;
    }
    List<AssigneeInfo> agents = agentsOf(e.assigneeIds());
    if (agents.isEmpty()) {
      return;
    }
    IssueRow issue = issueRepository.findById(e.issueId()).orElse(null);
    if (issue == null) {
      return;
    }
    for (AssigneeInfo agent : agents) {
      if (!agent.isExternalAgent()) {
        resetInternalInterrupt(issue.id(), agent.id());
        continue;
      }
      // 읽은 진행 중 행을 그대로 넘겨 markState 가 다시 읽지 않게 한다.
      AgentWorkRow active = agentWorkRepository.findActive(issue.id(), agent.id()).orElse(null);
      if (active != null) {
        agentWorkService.markState(issue.id(), active, AgentWorkState.SUBMITTED);
      } else {
        agentWorkService.submitForAssignees(issue.id(), issue.status(), List.of(agent));
      }
    }
    publisher.publishEvent(
        new WorkflowNodeWakeEvent(
            e.tenantId(),
            issue.id(),
            e.runId(),
            e.nodeKey(),
            agents.stream().map(AssigneeInfo::id).toList(),
            e.alreadyNotifiedIds(),
            e.actorId()));
  }

  /**
   * 내부 AI 가 노드에 다시 들어갈 때 남은 멈춤 상태를 풀어 준다(코드 리뷰 I3). 질문으로 떠나면 {@link #onNodeLeft} 가 내부 AI 의 행도
   * INPUT_REQUIRED 로 두는데, 답으로 돌아와도 그대로면 나중의 챗 답이 그 행을 되살려 같은 AI 를 한 번 더 깨운다(진입이 이미 깨웠다). 다시 시도로 돌아온
   * 차단(BLOCKED)·권한 필요도 같다 — 실행은 다시 진행 중인데 작업만 「차단됨」으로 남는다. 그래서 진행 중 행이 이 상태들이면 SUBMITTED 로 되돌린다. 행이
   * 없거나 작업 중 등이면 그대로 둔다(내부 AI 는 SUBMITTED 를 새로 만들지 않는다 — 지금 규칙).
   */
  private void resetInternalInterrupt(long issueId, long agentId) {
    agentWorkRepository
        .findActive(issueId, agentId)
        .filter(row -> AgentWorkState.holdsReasonNote(row.state()))
        .ifPresent(row -> agentWorkService.markState(issueId, row, AgentWorkState.SUBMITTED));
  }

  /**
   * 노드 떠남 — 실행 서비스가 떠난 노드가 agent_task 일 때 저장 뒤·다음 노드 진입 전에 부른다(같은 AI 가 다음 노드도 맡으면 이 닫기 뒤에 진입이 새
   * SUBMITTED 를 연다). 그 node_run 담당 AI 의 진행 중 작업을 COMPLETED 로 닫는다 — 이동으로 떠난 것은 실패가 아니라 끝낸 것이라
   * CANCELED 가 아니다. 질문으로 떠나면(asked) 닫지 않고 INPUT_REQUIRED 로 둔다(사람 목록에 「답변 필요」가 보이게). 진행 중 행이 없으면
   * 아무것도 하지 않는다(내부 AI 가 아직 보고하지 않음 등).
   *
   * @param nodeAssigneeIds 떠난 방문의 담당 — 그중 AI 만 본다
   * @param asked 대상 노드의 returnTo 가 떠난 노드인 질문 이동인지
   */
  public void onNodeLeft(long issueId, List<Long> nodeAssigneeIds, boolean asked) {
    markAgents(
        issueId, nodeAssigneeIds, asked ? AgentWorkState.INPUT_REQUIRED : AgentWorkState.COMPLETED);
  }

  /** 워크플로우 이동이 이슈 담당에서 뺀 사람 중 AI 의 반복만 거둔다 — 그 AI 의 작업은 {@link #onNodeLeft} 가 닫는다(설계 §5-1). */
  void retireRemovedAgents(long issueId, Collection<Long> removedIds) {
    if (removedIds == null || removedIds.isEmpty()) {
      return;
    }
    List<Long> agentIds = agentsOf(removedIds).stream().map(AssigneeInfo::id).toList();
    agentWorkService.retireRecurrence(issueId, agentIds);
  }

  /**
   * AI 의 작업 보고를 실행 상태에 맞물린다(설계 §5-2). 보고 서비스가 이슈·담당 확인 뒤, 무엇이든 저장하기 전에 부른다 — 거절이면 보고 전체가 아무것도 남기지
   * 않고, 반영은 agent_work 저장과 같은 트랜잭션이다.
   *
   * <p>활성 실행이 있고, 지금 노드가 agent_task 이며, 보고자가 지금 노드 담당(이동 권한과 같은 기준 — {@link MoveActor#isAssignee})일
   * 때만 본다. 그 밖(워크플로우 없음·사람 노드·손으로 넣은 담당)은 아무것도 하지 않는다 — 보고는 지금처럼 agent_work 만 바꾼다.
   *
   * <ul>
   *   <li>INPUT_REQUIRED·REVIEW·COMPLETED·CANCELED·REJECTED → 409 {@code WORKFLOW_USE_MOVE}.
   *       워크플로우에서 질문·검토·노드 끝내기는 노드 이동으로만 한다(원장 R9 — 작업만 끝내면 실행이 RUNNING 인 채 멈춘다)
   *   <li>BLOCKED·AUTH_REQUIRED → 지금 node_run BLOCKED(waiting_reason = 보고 상태, error = note) + 실행
   *       SUSPENDED + 이벤트 NODE_BLOCKED
   *   <li>FAILED → node_run FAILED(error = note) + 실행 SUSPENDED + 이벤트 NODE_FAILED
   *   <li>그 밖(WORKING·WAITING 등) → 그대로. 차단 뒤 WORKING 보고도 노드를 풀지 않는다(조치로만 푼다)
   * </ul>
   *
   * 이미 멈춘 실행(노드가 ACTIVE 가 아니거나 실행 SUSPENDED)에 다시 차단·실패를 보고하면 실행은 그대로 둔다 — revision·이벤트가 겹치지 않고 처음
   * 사유가 남는다.
   *
   * <p>잠금: 실행이 있으면 이슈 행을 먼저 잠근다 — 이동·조치와 같은 순서(이슈 → 구성원 → 실행)로 줄 세워, 보고가 본 노드를 그사이 이동이 옮기지 못하게 한다.
   *
   * @param note 보고에 저장될 note(없으면 null) — 막힘·실패 사유로 node_run.error 에 남긴다
   * @return 보고자가 지금 agent_task 노드의 담당이라 실행 규칙을 적용했으면 true(부르는 쪽이 보고 상태 바꾸기를 건너뛰는 데 쓴다)
   */
  public boolean onAgentReport(long issueId, long agentId, String state, String note) {
    if (runRepository.findActiveByIssue(issueId).isEmpty()) {
      return false;
    }
    issueRepository.findActiveByIdForNoKeyUpdate(issueId);
    RunRow run = runRepository.findActiveByIssue(issueId).orElse(null);
    if (run == null) {
      return false;
    }
    WorkflowModel model = modelOf(run.versionId());
    Node node = run.currentNode() == null ? null : model.nodes().get(run.currentNode());
    NodeRunRow visit = currentVisit(run);
    if (node == null || visit == null || !NodeTypes.AGENT_TASK.equals(node.type())) {
      return false;
    }
    // 이동 권한과 같은 판정을 쓰려고 판정에 필요한 칸만 채운 실행 모습을 만든다(노드 담당 ∩ 지금 이슈 담당).
    Set<Long> issueAssignees = new LinkedHashSet<>(assigneeRepository.findUserIdsByIssue(issueId));
    RunState runState =
        new RunState(
            model,
            run.status(),
            run.revision(),
            false,
            run.currentNode(),
            visit.status(),
            visit.assigneeIds(),
            issueAssignees,
            null,
            null);
    if (!new MoveActor(agentId, false).isAssignee(runState)) {
      return false;
    }
    // 진행만 알리는 보고(state 없음)는 상태를 바꾸지 않으므로 이동 규칙과 상관없다 — Set.of 는 null 을 물으면 NPE 라 먼저 거른다(코드 리뷰 I1).
    if (state != null && USE_MOVE_STATES.contains(state)) {
      // 멈춘 노드는 이동을 받지 않으므로(WORKFLOW_NODE_SUSPENDED) 「이동을 쓰라」는 따를 수 없는 안내다 — 이동 거절과 같은 code 로 조치를 먼저
      // 하라고 알린다(코드 리뷰 nit). 실행·작업은 그대로 두고 사람의 조치(/recover)를 기다린다.
      if (runState.isSuspended()) {
        throw WorkflowException.fromViolation(MoveViolation.nodeSuspended());
      }
      throw WorkflowException.useMove();
    }
    boolean blocked =
        AgentWorkState.BLOCKED.equals(state) || AgentWorkState.AUTH_REQUIRED.equals(state);
    boolean failed = AgentWorkState.FAILED.equals(state);
    if (!blocked && !failed) {
      return true;
    }
    if (runState.isSuspended()) {
      return true;
    }
    if (!runRepository.compareAndAdvance(
        run.id(), run.revision(), RunState.SUSPENDED, run.currentNode(), run.contextJson(), null)) {
      // 이슈 행을 잠근 뒤라 일어나지 않아야 한다 — 일어나면 반쯤 반영하지 않게 보고 전체를 되돌린다.
      RunRow now = runRepository.findRun(run.id()).orElse(run);
      throw WorkflowException.fromViolation(MoveViolation.stale(now.currentNode(), now.revision()));
    }
    runRepository.blockNodeRun(
        visit.id(),
        blocked ? RunState.NODE_BLOCKED : RunState.NODE_FAILED,
        blocked ? state : null,
        note);
    Instant now = Instant.now().truncatedTo(ChronoUnit.MICROS);
    runRepository.insertEvent(
        run.id(),
        blocked ? WorkflowRunWriter.NODE_BLOCKED : WorkflowRunWriter.NODE_FAILED,
        objectMapper.writeValueAsString(
            WorkflowRunWriter.map(
                "node", run.currentNode(), "nodeRunId", visit.id(), "state", state, "note", note)),
        agentId,
        now);
    return true;
  }

  /**
   * 이슈가 닫힘(완료·취소 상태로 바뀜)·삭제됐다(설계 §5-4). 그 이슈들의 활성 실행을 CANCELED(ended_at)로 끝내고, 열린 방문을 CANCELED 로
   * 닫고, 실행마다 이벤트 {@code RUN_CANCELED} 를 쌓고 {@link WorkflowRunEnded}(CANCELED) 를 발행한다. 활성 실행이 없으면
   * 아무것도 하지 않는다.
   *
   * <p>agent_work 는 건드리지 않는다 — 닫힘 경로가 곁에서 부르는 기존 종료({@code endAllOnIssueDone}·{@code
   * cancelAllForIssues})가 지금 규칙대로 닫는다. 다시 열어도 되살리지 않는다(옛 실행은 CANCELED 로 남고 새로 시작한다). 닫기는 아무도 깨우지
   * 않는다.
   *
   * <p>이벤트 행위자는 null(시스템) — 닫은 사람은 이슈 이력에 남고, 이 메서드는 여러 닫힘 경로(상태 삭제 일괄 이동 포함)가 공유한다.
   */
  public void onIssuesClosed(Collection<Long> issueIds) {
    if (issueIds == null || issueIds.isEmpty()) {
      return;
    }
    Instant now = Instant.now().truncatedTo(ChronoUnit.MICROS);
    List<RunRow> canceled = runRepository.cancelActiveRunsOfIssues(issueIds, now);
    if (canceled.isEmpty()) {
      return;
    }
    runRepository.cancelOpenNodeRuns(canceled.stream().map(RunRow::id).toList(), now);
    for (RunRow run : canceled) {
      recordRunCanceled(run.id(), run.issueId(), run.currentNode(), "ISSUE_CLOSED", null, now);
    }
  }

  /**
   * 취소로 끝난 실행 하나의 기록 — 이벤트 {@code RUN_CANCELED} 를 쌓고 {@link WorkflowRunEnded}(CANCELED) 를 발행한다. 이슈
   * 닫힘과 조치 CANCEL 이 같은 모양을 남기게 한곳에 둔다(실행 행·방문 상태는 부르는 쪽이 이미 바꿨다).
   *
   * @param reason 취소 사유(ISSUE_CLOSED·RECOVER)
   * @param actorId 취소한 사람(시스템이면 null)
   */
  void recordRunCanceled(
      long runId, long issueId, String node, String reason, Long actorId, Instant now) {
    runRepository.insertEvent(
        runId,
        WorkflowRunWriter.RUN_CANCELED,
        objectMapper.writeValueAsString(WorkflowRunWriter.map("node", node, "reason", reason)),
        actorId,
        now);
    publisher.publishEvent(
        new WorkflowRunEnded(TenantContext.get(), runId, issueId, RunState.CANCELED));
  }

  /**
   * 조치 CANCEL 로 끝난 노드의 AI 작업을 CANCELED 로 닫는다(설계 §5-5). 이슈 닫힘과 달리 곁에서 agent_work 를 닫아 줄 경로가 없어 여기서
   * 닫는다. 이미 끝난 행(FAILED 등)은 그대로 둔다. 취소는 아무도 깨우지 않는다.
   *
   * @param nodeAssigneeIds 지금 방문의 담당 — 그중 AI 만 본다
   */
  void cancelNodeAgents(long issueId, List<Long> nodeAssigneeIds) {
    markAgents(issueId, nodeAssigneeIds, AgentWorkState.CANCELED);
  }

  /** 담당 중 AI 의 진행 중 작업을 모두 지정 상태로 바꾼다(노드 떠남·조치 취소가 같이 쓴다). 담당이 없으면 아무것도 하지 않는다. */
  private void markAgents(long issueId, List<Long> assigneeIds, String state) {
    if (assigneeIds == null || assigneeIds.isEmpty()) {
      return;
    }
    for (AssigneeInfo agent : agentsOf(assigneeIds)) {
      agentWorkService.markState(issueId, agent.id(), state);
    }
  }

  /** 실행의 지금 방문 — 지금 노드 키의 가장 최근 node_run(실행 view 의 판정과 같다). 없으면 null. */
  private NodeRunRow currentVisit(RunRow run) {
    return NodeRunRow.latestVisit(runRepository.findNodeRuns(run.id()), run.currentNode());
  }

  /** 서버 실행기의 정상 끝을 워크플로우가 어떻게 받았는지 — 부르는 쪽이 작업 기록을 어떻게 남길지 정한다. */
  public enum ServerRunSuccess {
    /** 워크플로우와 상관없다 — 지금처럼 검토 대기를 쓴다. */
    NOT_OWNED,
    /** 워크플로우가 맡았고 작업 기록은 그대로 둔다(검토 대기를 쓰지 않는다). */
    OWNED,
    /**
     * 노드 담당이 이동 없이 끝났다 — 부르는 쪽은 작업을 시작 전(SUBMITTED, note 「이동 없이 실행이 끝났습니다」)으로 남긴다(행이 없으면 연다).
     * 실행·node_run 은 그대로다.
     */
    SUBMIT
  }

  /**
   * 서버 실행기(내부 AI)의 정상 끝(FINISHED ok)을 워크플로우가 어떻게 받는지(코드 리뷰 I2·WP-1986 판정 F4). 어느 경우든 검토 대기는 쓰지 않는다
   * — 워크플로우에서 검토·노드 끝내기는 이동으로만 한다(원장 R9).
   *
   * <ul>
   *   <li>활성 실행의 지금 agent_task 노드 담당이고 진행 중 행이 WORKING·SUBMITTED 거나 없으면 {@link
   *       ServerRunSuccess#SUBMIT}. 노드를 멈추지 않는다 — 끝 보고에는 어느 실행인지·무엇이 깨웠는지가 없어, 멈추면 사람 댓글에 답만 한 실행이나
   *       늦게 온 옛 실행의 끝도 잘 가던 노드를 멈춘다. 시작 전과 note 로 「일하는 중이 아님」만 보이고, 노드는 보통 이동이나 새 깨우기로 이어 갈 수 있게
   *       둔다
   *   <li>노드 담당인데 행이 기다림·끼어듦(WAITING·INPUT_REQUIRED·AUTH_REQUIRED·BLOCKED)이면 {@link
   *       ServerRunSuccess#OWNED} — 이미 다른 사람 차례·멈춤이 보이니 손대지 않는다
   *   <li>이미 노드를 떠난 AI 면 {@link ServerRunSuccess#OWNED} — 떠날 때 {@link #onNodeLeft} 가 행을 COMPLETED 로
   *       닫았는데, 실행 끝 보고가 그 뒤에 오면 진행 중 행이 없어 새 「검토 대기」 행이 생겨 끝낸 일을 다시 검토 대기로 되돌린다. 판정: 진행 중 행이 없고, 이
   *       이슈의 지금 실행(활성, 없으면 가장 최근 — end 로 옮겨 끝난 실행 포함)에서 떠난 방문의 담당이었다
   *   <li>그 밖(워크플로우 없음·손으로 넣은 담당 등)은 {@link ServerRunSuccess#NOT_OWNED} — 지금처럼 검토 대기를 쓴다
   * </ul>
   *
   * 노드 담당 판정은 {@link #onAgentReport} 에 상태 없이(진행만 알리는 보고처럼) 물어 같은 기준·같은 잠금을 쓴다 — 상태가 없으니 아무것도 바꾸지
   * 않는다.
   */
  public ServerRunSuccess onServerRunSuccess(long issueId, long agentId) {
    if (onAgentReport(issueId, agentId, null, null)) {
      // 위 호출이 이슈 행을 잠근 뒤라 그사이 이동이 행을 바꾸지 못한다.
      String rowState =
          agentWorkRepository.findActive(issueId, agentId).map(AgentWorkRow::state).orElse(null);
      boolean notWaiting =
          rowState == null
              || AgentWorkState.WORKING.equals(rowState)
              || AgentWorkState.SUBMITTED.equals(rowState);
      return notWaiting ? ServerRunSuccess.SUBMIT : ServerRunSuccess.OWNED;
    }
    if (agentWorkRepository.findActive(issueId, agentId).isPresent()) {
      return ServerRunSuccess.NOT_OWNED;
    }
    RunRow run = runRepository.findCurrentByIssue(issueId).orElse(null);
    if (run == null) {
      return ServerRunSuccess.NOT_OWNED;
    }
    boolean leftNode =
        runRepository.findNodeRuns(run.id()).stream()
            .anyMatch(v -> v.leftAt() != null && v.assigneeIds().contains(agentId));
    return leftNode ? ServerRunSuccess.OWNED : ServerRunSuccess.NOT_OWNED;
  }

  /** 워크플로우 이슈인지 — 그 이슈에 활성 실행이 있다. */
  @Transactional(readOnly = true)
  public boolean isWorkflowIssue(long issueId) {
    return runRepository.findActiveByIssue(issueId).isPresent();
  }

  /**
   * 이 이슈에 워크플로우가 시작될 수 있는지(코드 리뷰 I4) — 프로젝트의 켜져 있고 게시된 정의 중 하나라도 시작 조건(start 의 assigneeRole)이 이슈의
   * 지금 담당과 맞는다. 담당 지정의 깨우기 억제(설계 §5-3·§9-4)를 프로젝트 전체가 아니라 워크플로우가 맡을 수 있는 이슈로 좁힌다 — 어떤 정의도 시작할 수 없는
   * 이슈(시작 역할의 사람이 담당에 없음)는 워크플로우가 깨울 일이 없으므로 지금처럼 담당 지정이 깨운다.
   *
   * <p>정의에는 이슈 유형 같은 다른 적용 범위가 없다(정의 표·모델에 칸이 없다) — 시작 조건만 본다. 판정은 실제 시작과 같은 함수({@link
   * WorkflowRouting#start})·같은 구성원 표를 쓴다. 모델은 RLS 로 보인 정의 행의 활성 버전 id 로만 캐시에서 꺼낸다(캐시 규칙).
   *
   * @param assigneeIds 판정할 이슈 담당(담당 교체 뒤의 값)
   */
  @Transactional(readOnly = true)
  public boolean couldStartFor(long projectId, Collection<Long> assigneeIds) {
    List<Long> versionIds = workflowRepository.findEnabledPublishedVersionIds(projectId);
    if (versionIds.isEmpty() || assigneeIds == null || assigneeIds.isEmpty()) {
      return false;
    }
    List<ActiveMember> active = memberLookup.activeMembersOf(projectId);
    for (Long versionId : versionIds) {
      WorkflowModel model = modelOf(versionId);
      if (WorkflowRouting.start(model, assigneeIds, RunRoleMembers.of(model, active)).isPresent()) {
        return true;
      }
    }
    return false;
  }

  /** 버전의 모델 — RLS 로 보인 실행·정의 행의 버전 id 로만 부른다(캐시 규칙). */
  private WorkflowModel modelOf(long versionId) {
    return modelLoader.get(versionId);
  }

  /** id 들 중 AI(AGENT) 구성원 — 사용자 정보를 한 번에 읽어 종류·실행 방식을 함께 본다. 입력 순서를 지킨다. */
  private List<AssigneeInfo> agentsOf(Collection<Long> ids) {
    List<AssigneeInfo> infos = userRepository.findAssigneeInfos(ids, TenantContext.get());
    return ids.stream()
        .distinct()
        .flatMap(id -> infos.stream().filter(i -> id.equals(i.id())).limit(1))
        .filter(i -> i.isExternalAgent() || i.isInternalAgent())
        .toList();
  }
}
