package com.workplace.issue.service;

import com.workplace.issue.domain.IssueDependencyGraph;
import com.workplace.issue.dto.IssueRow;
import com.workplace.issue.exception.DependencyCycleException;
import com.workplace.issue.exception.InvalidDependencyException;
import com.workplace.issue.exception.IssueNotFoundException;
import com.workplace.issue.outbound.IssueChangeNotifier;
import com.workplace.issue.repository.IssueDependencyRepository;
import com.workplace.issue.repository.IssueRepository;
import com.workplace.project.dto.ProjectRow;
import com.workplace.project.service.ProjectAccessGuard;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * 이슈 의존성 라이프사이클 — 가드(멤버/같은 프로젝트/자기 자신/없는 이슈) + DFS 사이클 검출 + history 기록. (Phase 4b)
 *
 * <p>(issue_id=A, blocks_issue_id=B) row 는 "A 가 B 를 차단" 을 의미. direction 인자로 호출자 관점의 방향을 받아 저장 시점에 두
 * 이슈를 from/to 로 정규화한다.
 */
@Service
@Transactional
@RequiredArgsConstructor
public class IssueDependencyService {

  private final IssueDependencyRepository depRepository;
  private final IssueRepository issueRepository;
  private final ProjectAccessGuard accessGuard;
  private final IssueHistoryRecorder historyRecorder;
  private final IssueChangeNotifier changeNotifier;

  /**
   * 의존성 추가. direction="blocks" → (this, other), direction="blockedBy" → (other, this). 중복은 멱등(no-op
   * + history 미기록), 사이클은 409. history 는 양쪽 이슈에 남긴다 — 상대 이슈에는 반대 방향으로(WP-1125).
   */
  public void add(Long callerId, String projectKey, int number, int otherNumber, String direction) {
    var project = accessGuard.assertMember(projectKey, callerId);
    requireDirection(direction);
    var thisRow =
        issueRepository
            .findByProjectAndNumber(project.id(), number)
            .orElseThrow(() -> new IssueNotFoundException(projectKey, number));
    if (otherNumber == number) {
      throw new InvalidDependencyException("자기 자신과는 연결할 수 없습니다");
    }
    var otherRow =
        issueRepository
            .findByProjectAndNumber(project.id(), otherNumber)
            .orElseThrow(() -> new InvalidDependencyException("이 프로젝트에 없는 이슈 번호입니다"));

    // 관계는 늘 (막는 쪽 → 막히는 쪽) 으로 저장한다.
    boolean blockedBy = "blockedBy".equals(direction);
    Long fromId = blockedBy ? otherRow.id() : thisRow.id();
    Long toId = blockedBy ? thisRow.id() : otherRow.id();

    // 순환 검사와 저장 사이에 같은 프로젝트의 다른 추가가 끼지 않게 잠근다(WP-758) — 나중 요청은 앞 요청이 커밋한 관계까지 보고 판정한다.
    depRepository.lockProjectDependencies(project.id());
    if (depRepository.exists(fromId, toId)) {
      // 멱등 — history 미기록.
      return;
    }
    if (wouldCycle(fromId, toId)) {
      throw new DependencyCycleException();
    }
    depRepository.add(fromId, toId, callerId);
    recordBoth(historyRecorder::recordDependencyAdded, callerId, thisRow, otherRow, blockedBy);
    notifyBoth(project, thisRow, otherRow, callerId);
  }

  /** 이력 한 줄 기록 — recordDependencyAdded·recordDependencyRemoved 를 같은 모양으로 받는다. */
  @FunctionalInterface
  private interface DependencyHistory {
    void record(Long callerId, Long issueId, int otherNumber, String otherTitle, String direction);
  }

  /**
   * 양쪽 이슈 이력에 남긴다(WP-1125) — 전에는 호출 이슈에만 남아 상대 이슈 활동에서 보이지 않았다. 상대 이슈에는 반대 방향으로 적는다(내가 막으면 상대는
   * 막힌다). 관계의 recordBoth 와 같은 규칙.
   */
  private static void recordBoth(
      DependencyHistory history,
      Long callerId,
      IssueRow thisRow,
      IssueRow otherRow,
      boolean blockedBy) {
    history.record(
        callerId,
        thisRow.id(),
        otherRow.number(),
        otherRow.title(),
        blockedBy ? "blockedBy" : "blocks");
    history.record(
        callerId,
        otherRow.id(),
        thisRow.number(),
        thisRow.title(),
        blockedBy ? "blocks" : "blockedBy");
  }

  /**
   * 의존성 제거. direction 에 따라 동일 정규화. 0건 삭제(이미 없음) 면 history 미기록 — 기록하면 양쪽 이슈에(add 와 같다). 컨트롤러는 항상 204
   * 응답.
   */
  public void remove(
      Long callerId, String projectKey, int number, int otherNumber, String direction) {
    var project = accessGuard.assertMember(projectKey, callerId);
    requireDirection(direction);
    var thisRow =
        issueRepository
            .findByProjectAndNumber(project.id(), number)
            .orElseThrow(() -> new IssueNotFoundException(projectKey, number));
    var otherRow =
        issueRepository
            .findByProjectAndNumber(project.id(), otherNumber)
            .orElseThrow(() -> new InvalidDependencyException("이 프로젝트에 없는 이슈 번호입니다"));

    // 관계는 늘 (막는 쪽 → 막히는 쪽) 으로 저장한다.
    boolean blockedBy = "blockedBy".equals(direction);
    Long fromId = blockedBy ? otherRow.id() : thisRow.id();
    Long toId = blockedBy ? thisRow.id() : otherRow.id();

    int removed = depRepository.remove(fromId, toId);
    if (removed > 0) {
      recordBoth(historyRecorder::recordDependencyRemoved, callerId, thisRow, otherRow, blockedBy);
      notifyBoth(project, thisRow, otherRow, callerId);
    }
  }

  /**
   * direction 값 검사(WP-586) — blocks·blockedBy 만 받는다. 전에는 blockedBy 가 아니면 모두 blocks 로 보아 「blockedby」
   * 같은 오타가 반대 방향 관계로 저장·삭제되고 이력에 알 수 없는 값이 남았다(MCP·AI 도구도 같은 API). 멤버 검사 뒤에 둬 비멤버에게 다른 응답을 주지 않는다.
   */
  private static void requireDirection(String direction) {
    if (!"blocks".equals(direction) && !"blockedBy".equals(direction)) {
      throw new InvalidDependencyException("의존성 방향은 blocks 또는 blockedBy 만 쓸 수 있습니다");
    }
  }

  /**
   * 의존성은 양쪽 이슈 상세(차단/피차단)가 모두 바뀌므로 두 이슈 각각 알린다. 의존성 추가·제거는 정리성 쓰기라 어느 쪽 AI 작업도 시작·재개하지 않는다 (WP-425
   * — 전에는 호출자가 쓴 이슈만 터치했다).
   */
  private void notifyBoth(ProjectRow project, IssueRow thisRow, IssueRow otherRow, Long callerId) {
    changeNotifier.updatedWithoutTouch(project, thisRow.number(), thisRow.id(), callerId);
    changeNotifier.updatedWithoutTouch(project, otherRow.number(), otherRow.id(), callerId);
  }

  /**
   * (from, to) 추가 시 to → ... → from 경로가 존재하면 cycle. iterative DFS 로 방문 노드를 추적하여 무한 루프 방지. 기존 그래프는
   * 사이클 없음을 가정.
   */
  private boolean wouldCycle(Long fromId, Long toId) {
    return IssueDependencyGraph.reaches(toId, fromId, depRepository::findBlocksOf);
  }
}
