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
    var row =
        repository
            .insertIfAbsent(issueId, workerId, tool, initial)
            .orElseThrow(() -> new IllegalStateException("agent_work 생성 후 조회 실패"));
    // 답변 필요·인증 필요에서 다른 상태로 바뀌는데 새 note 가 없으면 질문·요청 note 를 지운다 — 남기면 "작업 중 · 질문" 으로 아직 묻는 것처럼 보인다.
    boolean leavingInterrupt =
        isInterrupt(row.state())
            && patch.state() != null
            && !row.state().equals(patch.state())
            && patch.note() == null;
    var effective = patch.withTool(tool);
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
    repository.update(row.id(), effective);
    notifyChanged(issueId, workerId);
    // 동시 종료로 조회에서 이슈가 빠지면(종료 이슈 제외) NPE 대신 409 로 답한다.
    return viewsByIssueIds(List.of(issueId)).getOrDefault(issueId, List.of()).stream()
        .filter(v -> v.worker().id() == workerId)
        .findFirst()
        .orElseThrow(AgentWorkIssueClosedException::new);
  }

  /** 종료 — 진행 중이면 지정한 종료 상태(COMPLETED·FAILED·CANCELED·REJECTED)로 끝내고 알림, 없으면 false. */
  public boolean end(long issueId, long workerId, String terminalState) {
    if (repository.endActiveForWorkers(issueId, List.of(workerId), terminalState) == 0) {
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
      repository.insertIfAbsent(e.issueId(), e.actorId(), e.tool(), AgentWorkState.WORKING);
    } else {
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
