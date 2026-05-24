package com.workplace.issue.service;

import com.workplace.issue.exception.DependencyCycleException;
import com.workplace.issue.exception.InvalidDependencyException;
import com.workplace.issue.exception.IssueNotFoundException;
import com.workplace.issue.repository.IssueDependencyRepository;
import com.workplace.issue.repository.IssueRepository;
import com.workplace.project.service.ProjectAccessGuard;
import java.util.ArrayDeque;
import java.util.Deque;
import java.util.HashSet;
import java.util.Set;
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

  /**
   * 의존성 추가. direction="blocks" → (this, other), direction="blockedBy" → (other, this). 중복은 멱등(no-op
   * + history 미기록), 사이클은 409. history 의 issueId 는 호출 이슈(this).
   */
  public void add(Long callerId, String projectKey, int number, int otherNumber, String direction) {
    var project = accessGuard.assertMember(projectKey, callerId);
    var thisRow =
        issueRepository
            .findByProjectAndNumber(project.id(), number)
            .orElseThrow(() -> new IssueNotFoundException(projectKey, number));
    if (otherNumber == number) {
      throw new InvalidDependencyException("자기 자신");
    }
    var otherRow =
        issueRepository
            .findByProjectAndNumber(project.id(), otherNumber)
            .orElseThrow(() -> new InvalidDependencyException("없는 이슈 또는 다른 프로젝트"));

    Long fromId;
    Long toId;
    if ("blockedBy".equals(direction)) {
      fromId = otherRow.id();
      toId = thisRow.id();
    } else {
      // 기본 "blocks"
      fromId = thisRow.id();
      toId = otherRow.id();
    }

    if (depRepository.exists(fromId, toId)) {
      // 멱등 — history 미기록.
      return;
    }
    if (wouldCycle(fromId, toId)) {
      throw new DependencyCycleException();
    }
    depRepository.add(fromId, toId, callerId);
    historyRecorder.recordDependencyAdded(
        callerId, thisRow.id(), otherRow.number(), otherRow.title(), direction);
  }

  /** 의존성 제거. direction 에 따라 동일 정규화. 0건 삭제(이미 없음) 면 history 미기록. 컨트롤러는 항상 204 응답. */
  public void remove(
      Long callerId, String projectKey, int number, int otherNumber, String direction) {
    var project = accessGuard.assertMember(projectKey, callerId);
    var thisRow =
        issueRepository
            .findByProjectAndNumber(project.id(), number)
            .orElseThrow(() -> new IssueNotFoundException(projectKey, number));
    var otherRow =
        issueRepository
            .findByProjectAndNumber(project.id(), otherNumber)
            .orElseThrow(() -> new InvalidDependencyException("없는 이슈 또는 다른 프로젝트"));

    Long fromId;
    Long toId;
    if ("blockedBy".equals(direction)) {
      fromId = otherRow.id();
      toId = thisRow.id();
    } else {
      fromId = thisRow.id();
      toId = otherRow.id();
    }

    int removed = depRepository.remove(fromId, toId);
    if (removed > 0) {
      historyRecorder.recordDependencyRemoved(
          callerId, thisRow.id(), otherRow.number(), otherRow.title(), direction);
    }
  }

  /**
   * (from, to) 추가 시 to → ... → from 경로가 존재하면 cycle. iterative DFS 로 방문 노드를 추적하여 무한 루프 방지. 기존 그래프는
   * 사이클 없음을 가정.
   */
  private boolean wouldCycle(Long fromId, Long toId) {
    Set<Long> visited = new HashSet<>();
    Deque<Long> stack = new ArrayDeque<>();
    stack.push(toId);
    while (!stack.isEmpty()) {
      Long cur = stack.pop();
      if (cur.equals(fromId)) return true;
      if (!visited.add(cur)) continue;
      for (Long next : depRepository.findBlocksOf(cur)) {
        stack.push(next);
      }
    }
    return false;
  }
}
