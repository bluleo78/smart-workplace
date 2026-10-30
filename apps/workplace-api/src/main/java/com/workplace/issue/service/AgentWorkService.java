package com.workplace.issue.service;

import com.workplace.auth.outbound.PersonalAssistantDisabled;
import com.workplace.issue.dto.AgentWorkPatch;
import com.workplace.issue.dto.AgentWorkState;
import com.workplace.issue.dto.AgentWorkTransition;
import com.workplace.issue.dto.AgentWorkView;
import com.workplace.issue.dto.IssueRow;
import com.workplace.issue.dto.IssueStatuses;
import com.workplace.issue.exception.AgentWorkIssueClosedException;
import com.workplace.issue.outbound.AgentToolWriteEvent;
import com.workplace.issue.outbound.AgentWorkAutoStarted;
import com.workplace.issue.outbound.AgentWorkNoticeEvent;
import com.workplace.issue.outbound.AgentsResumedByChatReply;
import com.workplace.issue.outbound.IssueChangeNotifier;
import com.workplace.issue.outbound.IssueHumanReplyPosted;
import com.workplace.issue.repository.AgentWorkRepository;
import com.workplace.issue.repository.AgentWorkRepository.InsertOutcome;
import com.workplace.issue.repository.IssueAssigneeRepository;
import com.workplace.issue.repository.IssueRecurrenceRepository;
import com.workplace.issue.repository.IssueRepository;
import com.workplace.project.dto.ProjectRow;
import com.workplace.project.repository.ProjectRepository;
import com.workplace.user.dto.AgentRuntime;
import com.workplace.user.dto.AssigneeInfo;
import com.workplace.user.outbound.AgentRuntimeChanged;
import java.util.ArrayList;
import java.util.Collection;
import java.util.Comparator;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.stream.Collectors;
import lombok.RequiredArgsConstructor;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.context.event.EventListener;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * AI 작업 기록(agent_work) 서비스(WP-377). 이슈별 진행 중 작업의 조회(급한 순)·시작/갱신·종료와 변경 알림을 맡는다.
 * IssueService·IssueSearchService 가 이 서비스를 쓰므로(응답 조립) 이쪽은 그들에 의존하지 않는다 — 순환 의존 방지.
 */
@Service
@Transactional
@RequiredArgsConstructor
public class AgentWorkService {

  /** 대표 순서 — 급한 상태 먼저, 같으면 최근 보고가 먼저. */
  private static final Comparator<AgentWorkView> URGENCY_ORDER =
      Comparator.comparingInt((AgentWorkView v) -> AgentWorkState.rank(v.state()))
          .thenComparing(AgentWorkView::updatedAt, Comparator.reverseOrder());

  private final AgentWorkRepository repository;
  // 터치 처리에서 담당자 여부를 재확인한다(담당 해제 직후 되살아나지 않게).
  private final IssueAssigneeRepository assigneeRepository;
  // 작업 기록을 닫는 경로(이슈 종료·삭제·담당 해제)에서 반복도 함께 거둔다(WP-1114). 반복을 먼저 잠가 결과 보고(반복 → 작업 기록)와 잠금 순서를
  // 맞춘다.
  private final IssueRecurrenceRepository recurrenceRepository;
  private final IssueRepository issueRepository;
  private final ProjectRepository projectRepository;
  private final IssueChangeNotifier notifier;
  // 자동 시작을 알려 이슈 상태(TODO → 진행 중)를 맞추게 한다 — IssueService 를 직접 쓰면 순환 의존이라 이벤트로 넘긴다(WP-393).
  private final ApplicationEventPublisher publisher;

  /** 이슈들의 진행 중 작업을 급한 순으로 정렬해 이슈별로 돌려준다. 작업 없는 이슈는 키가 없다. */
  @Transactional(readOnly = true)
  public Map<Long, List<AgentWorkView>> viewsByIssueIds(Collection<Long> issueIds) {
    var found = repository.findActiveByIssueIds(issueIds);
    if (found.isEmpty()) return Map.of();
    return found.entrySet().stream()
        .collect(
            Collectors.toMap(
                Map.Entry::getKey,
                e -> e.getValue().stream().map(AgentWorkView::of).sorted(URGENCY_ORDER).toList()));
  }

  /** 지정한 종료 작업들의 뷰를 이슈 id 로(WP-396 — AI 위임 작업 「완료」 보기의 대표 배지, 고르는 건 목록 쿼리). */
  @Transactional(readOnly = true)
  public Map<Long, AgentWorkView> endedViewsByIds(Collection<Long> workIds) {
    return repository.findEndedByIds(workIds).entrySet().stream()
        .collect(Collectors.toMap(Map.Entry::getKey, e -> AgentWorkView.of(e.getValue())));
  }

  /**
   * 보고 — (이슈, 작업자)의 진행 중 작업이 없으면 만들고(상태 미지정 시 WORKING) 있으면 보낸 필드만 갱신한다. tool 은 항상 최신 값으로 덮는다. 변경
   * 알림을 낸다.
   */
  public AgentWorkView startOrUpdate(
      long issueId, long workerId, String tool, AgentWorkPatch patch) {
    return startOrUpdateTracked(issueId, workerId, tool, patch).view();
  }

  /**
   * {@link #startOrUpdate} 와 같고 갱신 전 상태를 함께 돌려준다(새 행이면 null) — 보고 쪽이 「상태가 바뀐 순간」에만 알림을 내려고
   * 비교한다(WP-913).
   */
  public AgentWorkTransition startOrUpdateTracked(
      long issueId, long workerId, String tool, AgentWorkPatch patch) {
    String initial =
        AgentWorkState.isActive(patch.state()) ? patch.state() : AgentWorkState.WORKING;
    // 충돌로 기존 행을 돌려받았는데 그 사이 다른 트랜잭션이 종료해 진행 중 행이 없으면(조회가 비면) 500 이 아니라 409 로 답한다.
    var outcome =
        repository
            .insertOutcome(
                issueId,
                workerId,
                tool,
                initial,
                patch.clearNote() ? null : patch.note(),
                patch.progress(),
                patch.stepsDone(),
                patch.stepsTotal(),
                patch.nextRunAt())
            .orElseThrow(AgentWorkIssueClosedException::new);
    var row = outcome.row();
    // 첫 보고는 위 insert 가 값(도구·상태·note·진행률)을 이미 담았으므로 같은 값을 다시 쓰지 않는다 — 이력도 보고당 한 번만 남는다.
    // 이미 있던 행이면 아래 규칙으로 보낸 필드만 갱신한다. 읽은 뒤 다른 트랜잭션이 행을 종료했다면 update 는 0행 — 종료 행에 진행 값을 쓰지 않고 409 로
    // 답한다.
    if (!outcome.inserted()) {
      // 답변 필요·인증 필요에서 다른 상태로 바뀌는데 새 note 가 없으면 질문·요청 note 를 지운다 — 남기면 "작업 중 · 질문" 으로 아직 묻는 것처럼 보인다.
      boolean leavingInterrupt =
          AgentWorkState.isInterrupt(row.state())
              && patch.state() != null
              && !row.state().equals(patch.state())
              && patch.note() == null;
      // tool 은 항상 요청 값으로 덮는다(비어 있던 SUBMITTED 행의 tool 도 이때 채워진다).
      var effective = patch.withTool(tool);
      // 담당자 추가로 미리 만들어 둔 "시작 전"(SUBMITTED) 행에 첫 보고가 상태 없이 왔으면 작업 중으로 — 새 행을 만들지 않고 같은 행을 이어 쓴다.
      if (AgentWorkState.SUBMITTED.equals(row.state()) && effective.state() == null) {
        effective = effective.withState(AgentWorkState.WORKING);
      }
      if (leavingInterrupt) effective = effective.withClearedNote();
      if (repository.update(row.id(), effective) == 0) throw new AgentWorkIssueClosedException();
    }
    notifyChanged(issueId, workerId);
    // 동시 종료로 조회에서 이슈가 빠지면(종료 이슈 제외) NPE 대신 409 로 답한다.
    var view =
        viewsByIssueIds(List.of(issueId)).getOrDefault(issueId, List.of()).stream()
            .filter(v -> v.worker().id() == workerId)
            .findFirst()
            .orElseThrow(AgentWorkIssueClosedException::new);
    // row 는 갱신 전에 읽은 행이다 — 새로 만든 행이면 직전 상태가 없다.
    return new AgentWorkTransition(view, outcome.inserted() ? null : row.state());
  }

  /**
   * 담당자로 새로 들어간 구성원 중 외부 실행 AI 에이전트에게 "시작 전"(SUBMITTED) 작업을 미리 만든다(A2A submitted). 이슈가 이미
   * 종료(DONE·CANCELED) 상태면 만들지 않는다. 내부 AI·사람은 대상이 아니다. 호출자가 이미 읽어 둔 사용자 정보로 실행 방식을 메모리에서 가려 추가 사용자
   * 쿼리가 없다. 이미 진행 중 작업이 있으면 삽입이 충돌로 아무것도 넣지 않아 멱등이다(이벤트도 없다). tool 은 아직 모르므로 null — 첫 보고·터치가 채운다.
   * 알림은 호출자(이슈 생성·담당자 변경 알림)가 이미 낸다.
   */
  public void submitForAssignees(
      long issueId, String issueStatus, Collection<AssigneeInfo> addedUsers) {
    if (addedUsers == null || addedUsers.isEmpty()) return;
    if (IssueStatuses.CLOSED.contains(issueStatus)) return;
    // 대상 전원을 한 문장으로 만든다(담당자 여럿이어도 쿼리 1회).
    repository.insertSubmitted(
        issueId,
        addedUsers.stream().filter(AssigneeInfo::isExternalAgent).map(AssigneeInfo::id).toList());
  }

  /**
   * 종료 — 진행 중이면 지정한 종료 상태(COMPLETED·FAILED·CANCELED·REJECTED)로 끝내고 알림, 없으면 false. values 의 tool 은
   * 행의 tool 이 비어 있을 때(시작 전 SUBMITTED 에서 곧바로 종료 보고) 채우고, note·진행률·단계 수는 보낸 것만 같은 문장에서 덮어 종료 이벤트에 마지막
   * 보고 값이 담긴다.
   */
  public boolean end(long issueId, long workerId, String terminalState, AgentWorkPatch values) {
    if (repository.endActiveForWorker(issueId, workerId, terminalState, values) == 0) {
      return false;
    }
    notifyChanged(issueId, workerId);
    return true;
  }

  /**
   * 서버가 대신 기록하는 작업(반복·서버 AI 실행 — WP-989·WP-1219)을 바꿔도 되는지 — 이슈가 열려 있고 그 AI 가 아직 담당이다. 끝났거나 담당에서
   * 빠졌으면 종료·담당 해제가 이미 기록을 닫았으므로 되살리지 않는다.
   */
  public boolean isLiveFor(IssueRow issue, long agentId) {
    return !IssueStatuses.CLOSED.contains(issue.status())
        && assigneeRepository.findUserIdsByIssue(issue.id()).contains(agentId);
  }

  /**
   * 서버가 대신 기록하는 작업이 알릴 상태({@link AgentWorkNoticeEvent#ON_ENTER} — 검토 대기·막힘 등)로 들어섰을 때, 명시 보고와 같은 AI
   * 작업 알림 경로로 알린다. 수신 후보도 보고 경로와 같은 [이 작업자 담당 행을 만든 사람, 보고자] 순서이고, 사람인지·이슈를 볼 수 있는지는 notify 가 판정한다.
   */
  public void publishEnteredNotice(IssueRow issue, long agentId, String state) {
    if (!AgentWorkNoticeEvent.ON_ENTER.contains(state)) return;
    List<Long> candidates = new ArrayList<>(2);
    assigneeRepository.findAssignedBy(issue.id(), agentId).ifPresent(candidates::add);
    if (issue.reporterId() != null) candidates.add(issue.reporterId());
    publisher.publishEvent(
        new AgentWorkNoticeEvent(issue.id(), agentId, state, candidates, List.of()));
  }

  /**
   * 이슈 완료(DONE)로 진행 중 작업을 모두 닫는다 — 일하던 작업은 COMPLETED, 아직 착수 전(SUBMITTED)이던 작업은 한 번도 일하지 않았으니
   * CANCELED. 그 이슈의 반복도 거둔다(WP-1114 — 상세에 「다음 실행 …」이 남지 않게). 알림은 호출자(이슈 updated 알림)가 이미 낸다.
   */
  public void endAllOnIssueDone(Collection<Long> issueIds) {
    recurrenceRepository.retire(issueIds, null);
    repository.endActiveOnIssueDone(issueIds);
  }

  /**
   * 이슈들의 진행 중 작업을 모두 취소한다 — 이슈 취소(CANCELED) 진입·이슈 삭제(부모와 함께 지워진 자식 포함). 그 이슈들의 반복도 거둔다(WP-1114).
   * 알림은 호출자(이슈 updated·deleted 알림)가 이미 낸다.
   */
  public void cancelAllForIssues(Collection<Long> issueIds) {
    recurrenceRepository.retire(issueIds, null);
    repository.endActive(issueIds, AgentWorkState.CANCELED);
  }

  /** 이슈에서 지정한 작업자들의 진행 중 작업만 취소하고, 그 AI 들이 돌리던 반복도 거둔다(담당 해제, WP-1114). 알림은 호출자가 이미 낸다. */
  public void cancelForWorkers(long issueId, Collection<Long> workerIds) {
    recurrenceRepository.retire(List.of(issueId), workerIds);
    repository.endActiveForWorkers(issueId, workerIds, AgentWorkState.CANCELED);
  }

  /**
   * AI 구성원의 실행 방식이 바뀌면 그 구성원의 AI 작업 기록을 새 방식에 맞춘다. 사용자 모듈 쪽 변경과 같은 트랜잭션의 동기 리스너.
   *
   * <ul>
   *   <li>외부→내부: "시작 전"(SUBMITTED) 작업을 취소한다 — 내부 AI 는 보고·터치를 하지 않아 그대로 두면 영영 "시작 전" 으로 남는다.
   *       일하던(WORKING 등) 작업은 건드리지 않는다.
   *   <li>내부→외부: 이미 담당자로 있는 열린 이슈마다 "시작 전" 작업을 만든다 — 담당자 추가 때는 내부라 만들지 않았던 이슈들이다. 이미 진행 중 작업이 있는
   *       이슈는 건너뛴다.
   * </ul>
   *
   * 바뀐 이슈는 한 번에 읽어(N+1 회피) 열려 있는 레일·AI 작업 목록이 갱신되도록 변경 알림을 낸다(터치는 재발행하지 않는다).
   */
  @EventListener
  public void onAgentRuntimeChanged(AgentRuntimeChanged e) {
    List<Long> changedIssueIds;
    if (AgentRuntime.INTERNAL.equals(e.runtime())) {
      changedIssueIds =
          repository.endActiveForWorkerInStates(
              e.agentUserId(), List.of(AgentWorkState.SUBMITTED), AgentWorkState.CANCELED);
    } else if (AgentRuntime.EXTERNAL.equals(e.runtime())) {
      changedIssueIds = repository.insertSubmittedForAssignedOpenIssues(e.agentUserId());
    } else {
      return;
    }
    if (changedIssueIds.isEmpty()) return;
    notifyChanged(issueRepository.findByIds(changedIssueIds), null);
  }

  /**
   * 개인 비서가 해제되면(WP-1190) 그 비서가 돌리던 반복을 모두 거두고, 반복 때문에 남은 「다음 회차 대기」(SCHEDULED) 작업을 취소한다 — 그대로 두면
   * 상세에 「다음 실행 …」, AI 위임 작업에 「다음 회차 대기」가 남아 비서 없이도 실행될 것처럼 보였다. 담당과 다른 상태의 작업(검토 대기 등 사람이 볼 결과)은
   * 그대로 둔다 — 같은 비서를 다시 등록하면 그 AGENT 를 다시 쓴다. auth 모듈 해제와 같은 트랜잭션의 동기 리스너.
   */
  @EventListener
  public void onPersonalAssistantDisabled(PersonalAssistantDisabled e) {
    recurrenceRepository.retireForAgent(e.agentUserId());
    List<Long> changedIssueIds =
        repository.endActiveForWorkerInStates(
            e.agentUserId(), List.of(AgentWorkState.SCHEDULED), AgentWorkState.CANCELED);
    if (changedIssueIds.isEmpty()) return;
    notifyChanged(issueRepository.findByIds(changedIssueIds), null);
  }

  /**
   * 사람이 챗 글·댓글로 응답하면 답변 필요(INPUT_REQUIRED)로 멈춘 AI 구성원 작업을 작업 중으로 되돌리고, 바뀐 게 있으면 알린다. 챗 글이면 되돌린 AI 중
   * 글에서 멘션되지 않은 AI 를 {@link AgentsResumedByChatReply} 로 내 알림으로 깨운다(WP-1067 — 멘션 없이 답해도 바로 이어 하게).
   */
  @EventListener
  public void onHumanReply(IssueHumanReplyPosted e) {
    List<Long> resumed = repository.resumeInputRequiredAgents(e.issueId());
    if (resumed.isEmpty()) return;
    notifyChanged(e.issueId(), null);
    if (e.chatActorId() == null) return;
    List<Long> toWake =
        resumed.stream().filter(id -> !e.chatMentionedIds().contains(id)).distinct().toList();
    if (!toWake.isEmpty()) {
      publisher.publishEvent(new AgentsResumedByChatReply(e.issueId(), e.chatActorId(), toWake));
    }
  }

  /**
   * MCP(수행 도구 헤더) 경유 이슈 쓰기 → 담당자 본인이면 AI 작업 자동 시작, 이미 있으면 상태 복귀 규칙(스펙 §4.2). 동기 리스너라 쓰기와 같은 트랜잭션에서
   * 돈다. 삭제·종료된 이슈와 담당자가 아닌 쓰기는 무시한다 — 완료 처리·담당 해제 직후 작업이 되살아나지 않게.
   */
  @EventListener
  public void onAgentToolWrite(AgentToolWriteEvent e) {
    // findById 는 삭제(deleted_at) 이슈를 돌려주지 않는다 — 비어 있으면 삭제된 이슈.
    var issue = issueRepository.findById(e.issueId()).orElse(null);
    if (issue == null || IssueStatuses.CLOSED.contains(issue.status())) return;
    if (!assigneeRepository.findUserIdsByIssue(e.issueId()).contains(e.actorId())) return;
    var existing = repository.findActive(e.issueId(), e.actorId());
    boolean valuesWritten = false;
    if (existing.isEmpty() && !e.promoteOnly()) {
      // 동시에 다른 트랜잭션(담당자 추가의 SUBMITTED 생성 등)이 먼저 행을 만들었으면 insert 는 충돌로 아무것도 넣지 않고 그 진행 중 행을 돌려준다.
      // 그 사이 종료돼 행이 없으면(빈 결과) 아무것도 하지 않는다. 새로 넣었으면 도구·상태가 이미 담겨 있어 아래 갱신이 필요 없다.
      var outcome =
          repository.insertOutcome(e.issueId(), e.actorId(), e.tool(), AgentWorkState.WORKING);
      existing = outcome.map(InsertOutcome::row);
      valuesWritten = outcome.map(InsertOutcome::inserted).orElse(false);
    }
    // 이번 쓰기로 작업이 막 시작됐는지 — 새 행을 넣었거나 시작 전(SUBMITTED)을 이었을 때만. 이미 일하던 작업의 터치·중단 상태 복귀는 시작이 아니다.
    boolean started =
        valuesWritten
            || existing.map(r -> AgentWorkState.SUBMITTED.equals(r.state())).orElse(false);
    if (existing.isPresent() && !valuesWritten) {
      String state = existing.get().state();
      // 답변 필요·인증 필요·막힘·일시 중지·시작 전(SUBMITTED)에서 다시 쓰기 시작했으면 움직인 것으로 보고 작업 중으로 되돌린다. 검토 필요·작업 중은 그대로
      // —
      // tool 갱신과 updated_at 터치(무소식 해소)만 한다.
      String next =
          AgentWorkState.RESUMES_TO_WORKING.contains(state) ? AgentWorkState.WORKING : null;
      // 답변 필요·인증 필요에서 복귀하면 질문·요청 note 는 낡았으므로 지운다(막힘·일시 중지의 사유 note 는 유지).
      boolean clearNote = AgentWorkState.isInterrupt(state);
      repository.update(
          existing.get().id(),
          new AgentWorkPatch(e.tool(), next, null, clearNote, null, null, null));
    }
    // 시작했으면 이슈가 할 일(TODO)일 때 진행 중으로 올린다 — 명시 보고와 같은 규칙(이력·알림 포함, WP-393). 이 쓰기가 상태를 직접 지정했으면
    // 요청한 상태가 우선이라 올리지 않는다. 위에서 읽은 이슈 행으로 TODO 를 먼저 거른다.
    if (started && !e.statusWritten() && "TODO".equals(issue.status())) {
      publisher.publishEvent(
          new AgentWorkAutoStarted(issue.projectId(), issue.number(), e.actorId()));
    }
    // 발행 쪽이 이슈 변경 알림을 이미 냈으면(이슈 updated 경유) 같은 알림을 다시 내지 않는다.
    if (!e.issueNotified()) notifyChanged(issue, e.actorId());
  }

  /** 이슈 행을 찾아 변경 알림을 낸다. 이슈가 이미 없으면 조용히 건너뛴다. */
  private void notifyChanged(long issueId, Long actorId) {
    issueRepository.findById(issueId).ifPresent(issue -> notifyChanged(issue, actorId));
  }

  /** 이미 읽은 이슈 행 하나의 변경 알림. */
  private void notifyChanged(IssueRow issue, Long actorId) {
    notifyChanged(List.of(issue), actorId);
  }

  /**
   * 이미 읽은 이슈 행들로 프로젝트만 찾아(프로젝트별 한 번만 조회) 변경 알림을 낸다. 프로젝트가 이미 없으면 그 이슈는 건너뛴다. 터치 알림이므로 AI 작업 터치는
   * 재발행하지 않는다(재귀 방지).
   */
  private void notifyChanged(Collection<IssueRow> issues, Long actorId) {
    Map<Long, Optional<ProjectRow>> projects = new HashMap<>();
    for (var issue : issues) {
      projects
          .computeIfAbsent(issue.projectId(), projectRepository::findById)
          .ifPresent(
              project ->
                  notifier.updatedWithoutTouch(project, issue.number(), issue.id(), actorId));
    }
  }
}
