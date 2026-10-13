package com.workplace.issue.service;

import com.workplace.issue.dto.AgentWorkPatch;
import com.workplace.issue.dto.AgentWorkState;
import com.workplace.issue.dto.AgentWorkView;
import com.workplace.issue.outbound.IssueChangeNotifier;
import com.workplace.issue.outbound.IssueChatHumanMessagePosted;
import com.workplace.issue.repository.AgentWorkRepository;
import com.workplace.issue.repository.IssueAssigneeRepository;
import com.workplace.issue.repository.IssueRepository;
import com.workplace.project.repository.ProjectRepository;
import java.time.Instant;
import java.util.Collection;
import java.util.Comparator;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
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
  // 터치 처리(담당자 여부 재확인)에서 쓴다 — 후속 작업에서 사용.
  private final IssueAssigneeRepository assigneeRepository;
  private final IssueRepository issueRepository;
  private final ProjectRepository projectRepository;
  private final IssueChangeNotifier notifier;

  /** 이슈들의 진행 중 작업을 급한 순으로 정렬해 이슈별로 돌려준다. 작업 없는 이슈는 키가 없다. */
  @Transactional(readOnly = true)
  public Map<Long, List<AgentWorkView>> viewsByIssueIds(Collection<Long> issueIds) {
    var found = repository.findActiveByIssueIds(issueIds);
    if (found.isEmpty()) return Map.of();
    Instant now = Instant.now();
    Map<Long, List<AgentWorkView>> result = new HashMap<>();
    found.forEach(
        (issueId, list) ->
            result.put(
                issueId,
                list.stream().map(w -> AgentWorkView.of(w, now)).sorted(URGENCY_ORDER).toList()));
    return result;
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
    repository.update(
        row.id(),
        new AgentWorkPatch(
            tool,
            patch.state(),
            patch.note(),
            patch.clearNote(),
            patch.progress(),
            patch.stepsDone(),
            patch.stepsTotal()));
    notifyChanged(issueId, workerId);
    return viewsByIssueIds(List.of(issueId)).get(issueId).stream()
        .filter(v -> v.worker().id() == workerId)
        .findFirst()
        .orElseThrow();
  }

  /** 종료 — 진행 중이면 끝내고 알림, 없으면 false. */
  public boolean end(long issueId, long workerId) {
    var active = repository.findActive(issueId, workerId);
    if (active.isEmpty() || !repository.endById(active.get().id())) return false;
    notifyChanged(issueId, workerId);
    return true;
  }

  /** 이슈의 진행 중 작업을 모두 종료한다. 알림은 호출자(이슈 updated 알림)가 이미 낸다. */
  public void endAllForIssue(long issueId) {
    repository.endActive(issueId);
  }

  /** 이슈에서 지정한 작업자들의 진행 중 작업만 종료한다. 알림은 호출자가 이미 낸다. */
  public void endForWorkers(long issueId, Collection<Long> workerIds) {
    repository.endActiveForWorkers(issueId, workerIds);
  }

  /** 사람이 챗에 글을 올리면 답변 필요로 멈춘 AI 구성원 작업을 작업 중으로 되돌리고, 바뀐 게 있으면 알린다. */
  @EventListener
  public void onHumanChatMessage(IssueChatHumanMessagePosted e) {
    if (repository.resumeWaitingAgents(e.issueId()) > 0) {
      notifyChanged(e.issueId(), null);
    }
  }

  /** 이슈·프로젝트 행을 찾아 변경 알림을 낸다. 이슈가 이미 없으면 조용히 건너뛴다. */
  private void notifyChanged(long issueId, Long actorId) {
    issueRepository
        .findById(issueId)
        .ifPresent(
            issue ->
                projectRepository
                    .findById(issue.projectId())
                    .ifPresent(
                        project ->
                            notifier.agentWorkChanged(project, issue.number(), issueId, actorId)));
  }
}
