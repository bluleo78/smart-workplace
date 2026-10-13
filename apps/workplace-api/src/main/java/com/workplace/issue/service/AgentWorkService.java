package com.workplace.issue.service;

import com.workplace.issue.dto.AgentWorkPatch;
import com.workplace.issue.dto.AgentWorkState;
import com.workplace.issue.dto.AgentWorkView;
import com.workplace.issue.dto.IssueRow;
import com.workplace.issue.dto.IssueStatuses;
import com.workplace.issue.exception.AgentWorkIssueClosedException;
import com.workplace.issue.outbound.AgentToolWriteEvent;
import com.workplace.issue.outbound.IssueChangeNotifier;
import com.workplace.issue.outbound.IssueHumanReplyPosted;
import com.workplace.issue.repository.AgentWorkRepository;
import com.workplace.issue.repository.IssueAssigneeRepository;
import com.workplace.issue.repository.IssueRepository;
import com.workplace.project.repository.ProjectRepository;
import com.workplace.user.dto.AgentRuntime;
import com.workplace.user.outbound.AgentRuntimeChanged;
import com.workplace.user.repository.UserRepository;
import java.util.Collection;
import java.util.Comparator;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;
import lombok.RequiredArgsConstructor;
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
  private final IssueRepository issueRepository;
  private final ProjectRepository projectRepository;
  private final UserRepository userRepository;
  private final IssueChangeNotifier notifier;

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

  /**
   * 보고 — (이슈, 작업자)의 진행 중 작업이 없으면 만들고(상태 미지정 시 WORKING) 있으면 보낸 필드만 갱신한다. tool 은 항상 최신 값으로 덮는다. 변경
   * 알림을 낸다.
   */
  public AgentWorkView startOrUpdate(
      long issueId, long workerId, String tool, AgentWorkPatch patch) {
    String initial =
        AgentWorkState.isActive(patch.state()) ? patch.state() : AgentWorkState.WORKING;
    // 충돌로 기존 행을 돌려받았는데 그 사이 다른 트랜잭션이 종료해 진행 중 행이 없으면(조회가 비면) 500 이 아니라 409 로 답한다.
    var row =
        repository
            .insertIfAbsent(
                issueId,
                workerId,
                tool,
                initial,
                patch.clearNote() ? null : patch.note(),
                patch.progress(),
                patch.stepsDone(),
                patch.stepsTotal())
            .orElseThrow(AgentWorkIssueClosedException::new);
    // 답변 필요·인증 필요에서 다른 상태로 바뀌는데 새 note 가 없으면 질문·요청 note 를 지운다 — 남기면 "작업 중 · 질문" 으로 아직 묻는 것처럼 보인다.
    boolean leavingInterrupt =
        isInterrupt(row.state())
            && patch.state() != null
            && !row.state().equals(patch.state())
            && patch.note() == null;
    var effective = patch.withTool(tool);
    // 담당자 추가로 미리 만들어 둔 "시작 전"(SUBMITTED) 행에 첫 보고가 상태 없이 왔으면 작업 중으로 — 새 행을 만들지 않고 같은 행을 이어 쓴다.
    // (tool 은 위 withTool 로 이미 요청 값이 실려 비어 있던 SUBMITTED 행의 tool 이 채워진다.)
    if (AgentWorkState.SUBMITTED.equals(row.state()) && effective.state() == null) {
      effective =
          new AgentWorkPatch(
              effective.tool(),
              AgentWorkState.WORKING,
              effective.note(),
              effective.clearNote(),
              effective.progress(),
              effective.stepsDone(),
              effective.stepsTotal());
    }
    if (leavingInterrupt) {
      effective =
          new AgentWorkPatch(
              effective.tool(),
              effective.state(),
              null,
              true,
              effective.progress(),
              effective.stepsDone(),
              effective.stepsTotal());
    }
    // 첫 보고는 위 insert 가 값을 이미 담았으므로 이 update 는 updated_at 만 올리고 이력은 남기지 않는다(같은 값).
    // 읽은 뒤 다른 트랜잭션이 행을 종료했다면 update 는 0행 — 종료 행에 진행 값을 쓰지 않고 409 로 답한다.
    if (repository.update(row.id(), effective) == 0) throw new AgentWorkIssueClosedException();
    notifyChanged(issueId, workerId);
    // 동시 종료로 조회에서 이슈가 빠지면(종료 이슈 제외) NPE 대신 409 로 답한다.
    return viewsByIssueIds(List.of(issueId)).getOrDefault(issueId, List.of()).stream()
        .filter(v -> v.worker().id() == workerId)
        .findFirst()
        .orElseThrow(AgentWorkIssueClosedException::new);
  }

  /**
   * 담당자로 새로 들어간 구성원 중 외부 실행 AI 에이전트에게 "시작 전"(SUBMITTED) 작업을 미리 만든다(A2A submitted). 이슈가 이미
   * 종료(DONE·CANCELED) 상태면 만들지 않는다. 내부 AI·사람은 대상이 아니다. 사용자는 한 번에 일괄 조회하고(N+1 회피), 이미 진행 중 작업이 있으면
   * insertIfAbsent 가 아무것도 넣지 않아 멱등이다(이벤트도 없다). tool 은 아직 모르므로 null — 첫 보고·터치가 채운다. 알림은 호출자(이슈
   * 생성·담당자 변경 알림)가 이미 낸다.
   */
  public void submitForAssignees(long issueId, String issueStatus, Collection<Long> addedUserIds) {
    if (addedUserIds == null || addedUserIds.isEmpty()) return;
    if (IssueStatuses.CLOSED.contains(issueStatus)) return;
    for (long agentId : userRepository.findAgentIdsByRuntime(addedUserIds, AgentRuntime.EXTERNAL)) {
      repository.insertIfAbsent(issueId, agentId, null, AgentWorkState.SUBMITTED);
    }
  }

  /**
   * 종료 — 진행 중이면 지정한 종료 상태(COMPLETED·FAILED·CANCELED·REJECTED)로 끝내고 알림, 없으면 false. 행의 tool 이 비어
   * 있으면(시작 전 SUBMITTED 에서 곧바로 종료 보고) 요청의 도구 값을 같은 문장에서 채운다.
   */
  public boolean end(long issueId, long workerId, String terminalState, String tool) {
    if (repository.endActiveForWorker(issueId, workerId, terminalState, tool) == 0) {
      return false;
    }
    notifyChanged(issueId, workerId);
    return true;
  }

  /**
   * 이슈 완료(DONE)로 진행 중 작업을 모두 닫는다 — 일하던 작업은 COMPLETED, 아직 착수 전(SUBMITTED)이던 작업은 한 번도 일하지 않았으니
   * CANCELED. 알림은 호출자(이슈 updated 알림)가 이미 낸다.
   */
  public void endAllOnIssueDone(Collection<Long> issueIds) {
    // SUBMITTED 를 먼저 취소해 둬야 나머지를 COMPLETED 로 닫을 때 섞이지 않는다.
    repository.endActiveInStates(
        issueIds, List.of(AgentWorkState.SUBMITTED), AgentWorkState.CANCELED);
    repository.endActive(issueIds, AgentWorkState.COMPLETED);
  }

  /**
   * 이슈들의 진행 중 작업을 모두 취소한다 — 이슈 취소(CANCELED) 진입·이슈 삭제(부모와 함께 지워진 자식 포함). 알림은 호출자(이슈 updated·deleted
   * 알림)가 이미 낸다.
   */
  public void cancelAllForIssues(Collection<Long> issueIds) {
    repository.endActive(issueIds, AgentWorkState.CANCELED);
  }

  /** 이슈에서 지정한 작업자들의 진행 중 작업만 취소한다(담당 해제). 알림은 호출자가 이미 낸다. */
  public void cancelForWorkers(long issueId, Collection<Long> workerIds) {
    repository.endActiveForWorkers(issueId, workerIds, AgentWorkState.CANCELED);
  }

  /**
   * AI 구성원이 외부→내부 실행 방식으로 바뀌면 그 구성원의 "시작 전"(SUBMITTED) 작업을 취소한다 — 내부 AI 는 보고·터치를 하지 않아 그대로 두면 영영
   * "시작 전" 으로 남는다. 일하던(WORKING 등) 작업은 건드리지 않는다. 사용자 모듈 쪽 변경과 같은 트랜잭션의 동기 리스너.
   */
  @EventListener
  public void onAgentRuntimeChanged(AgentRuntimeChanged e) {
    if (!AgentRuntime.INTERNAL.equals(e.runtime())) return;
    var issueIds =
        repository.endActiveForWorkerInStates(
            e.agentUserId(), List.of(AgentWorkState.SUBMITTED), AgentWorkState.CANCELED);
    // 열려 있는 레일·AI 작업 목록이 "시작 전" 을 계속 보이지 않도록 취소된 작업의 이슈마다 변경 알림을 낸다(터치는 재발행하지 않는다).
    for (long issueId : issueIds) {
      notifyChanged(issueId, null);
    }
  }

  /** 사람이 챗 글·댓글로 응답하면 답변 필요(INPUT_REQUIRED)로 멈춘 AI 구성원 작업을 작업 중으로 되돌리고, 바뀐 게 있으면 알린다. */
  @EventListener
  public void onHumanReply(IssueHumanReplyPosted e) {
    if (repository.resumeInputRequiredAgents(e.issueId()) > 0) {
      notifyChanged(e.issueId(), null);
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
    if (existing.isEmpty()) {
      // 동시에 다른 트랜잭션(담당자 추가의 SUBMITTED 생성 등)이 먼저 행을 만들었으면 insert 는 충돌로 아무것도 넣지 않고 그 진행 중 행을 돌려준다.
      // 돌려받은 행에 아래 갱신 규칙(시작 전 → 작업 중 + tool 채움)을 똑같이 적용한다.
      // 그 사이 종료돼 행이 없으면(빈 결과) 아무것도 하지 않는다.
      // 새로 넣은 경우에도 같은 경로를 타지만 값이 같아 갱신은 updated_at 터치뿐이고 이력은 남지 않는다.
      existing =
          repository.insertIfAbsent(e.issueId(), e.actorId(), e.tool(), AgentWorkState.WORKING);
    }
    if (existing.isPresent()) {
      String state = existing.get().state();
      // 답변 필요·인증 필요·막힘·일시 중지·시작 전(SUBMITTED)에서 다시 쓰기 시작했으면 움직인 것으로 보고 작업 중으로 되돌린다. 검토 필요는 검토 대기 중
      // PR 링크 코멘트 등이 흔해 유지하고, 작업 중은 그대로 — 둘 다 tool 갱신과 updated_at 터치(무소식 해소)만 한다.
      String next =
          AgentWorkState.REVIEW.equals(state) || AgentWorkState.WORKING.equals(state)
              ? null
              : AgentWorkState.WORKING;
      // 답변 필요·인증 필요에서 복귀하면 질문·요청 note 는 낡았으므로 지운다(막힘·일시 중지의 사유 note 는 유지).
      boolean clearNote = isInterrupt(state);
      repository.update(
          existing.get().id(),
          new AgentWorkPatch(e.tool(), next, null, clearNote, null, null, null));
    }
    // 발행 쪽이 이슈 변경 알림을 이미 냈으면(이슈 updated 경유) 같은 알림을 다시 내지 않는다.
    if (!e.issueNotified()) notifyChanged(issue, e.actorId());
  }

  /** 사람의 입력·권한을 기다리며 멈춘 상태(A2A interrupted)인지 — 이 상태의 note 는 질문·요청이라 벗어나면 낡는다. */
  private static boolean isInterrupt(String state) {
    return AgentWorkState.INPUT_REQUIRED.equals(state)
        || AgentWorkState.AUTH_REQUIRED.equals(state);
  }

  /** 이슈 행을 찾아 변경 알림을 낸다. 이슈가 이미 없으면 조용히 건너뛴다. */
  private void notifyChanged(long issueId, Long actorId) {
    issueRepository.findById(issueId).ifPresent(issue -> notifyChanged(issue, actorId));
  }

  /** 이미 읽은 이슈 행으로 프로젝트만 찾아 변경 알림을 낸다. 터치 알림이므로 AI 작업 터치는 재발행하지 않는다(재귀 방지). */
  private void notifyChanged(IssueRow issue, Long actorId) {
    projectRepository
        .findById(issue.projectId())
        .ifPresent(
            project -> notifier.updatedWithoutTouch(project, issue.number(), issue.id(), actorId));
  }
}
