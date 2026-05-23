package com.workplace.issue.service;

import com.workplace.issue.dto.UserSummary;
import com.workplace.issue.exception.InvalidAssigneeForProjectException;
import com.workplace.issue.exception.IssueNotFoundException;
import com.workplace.issue.repository.IssueAssigneeRepository;
import com.workplace.issue.repository.IssueRepository;
import com.workplace.project.repository.ProjectMemberRepository;
import com.workplace.project.service.ProjectAccessGuard;
import com.workplace.user.repository.UserRepository;
import com.workplace.watcher.service.WatcherAutoEnroller;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * 이슈 담당자 집합 교체 서비스. 라벨 패턴과 동일하게 diff 만 INSERT/DELETE 하고 ASSIGNEES_CHANGED 단일 history row 를 기록한다. 신규
 * 추가 사용자는 watcher 로 자동 등록된다.
 */
@Service
@Transactional
@RequiredArgsConstructor
public class IssueAssigneeService {

  private final IssueAssigneeRepository repo;
  private final IssueRepository issueRepository;
  private final ProjectMemberRepository memberRepository;
  private final ProjectAccessGuard accessGuard;
  private final IssueHistoryRecorder historyRecorder;
  private final WatcherAutoEnroller watcherAutoEnroller;
  private final UserRepository userRepository;

  /**
   * 이슈 담당자 집합을 통째로 교체한다.
   *
   * <ul>
   *   <li>호출자는 프로젝트 멤버여야 한다 (그렇지 않으면 ProjectAccessDeniedException).
   *   <li>대상 userIds 는 모두 프로젝트 멤버여야 한다 (그렇지 않으면 InvalidAssigneeForProjectException).
   *   <li>diff 0 이면 history 미기록.
   *   <li>새로 추가된 사용자는 watcher 로 자동 등록.
   * </ul>
   */
  public List<UserSummary> replace(
      Long callerId, String projectKey, int number, List<Long> userIds) {
    var project = accessGuard.assertMember(projectKey, callerId);
    var issue =
        issueRepository
            .findByProjectAndNumber(project.id(), number)
            .orElseThrow(() -> new IssueNotFoundException(projectKey, number));

    List<Long> normalized = userIds == null ? List.of() : userIds;

    // 1) 모든 userIds 가 프로젝트 멤버인지 검증
    if (!normalized.isEmpty()) {
      var memberIds = memberRepository.findUserIdsByProject(project.id());
      if (!new HashSet<>(memberIds).containsAll(normalized)) {
        throw new InvalidAssigneeForProjectException();
      }
    }

    // 2) diff 계산
    Set<Long> current = new HashSet<>(repo.findUserIdsByIssue(issue.id()));
    Set<Long> target = new HashSet<>(normalized);
    Set<Long> toAdd = new HashSet<>(target);
    toAdd.removeAll(current);
    Set<Long> toRemove = new HashSet<>(current);
    toRemove.removeAll(target);

    // 3) 제거 대상의 사용자 요약을 먼저 조회 (삭제 후에는 USER JOIN 으로 못 가져옴)
    List<UserSummary> removedSummaries = List.of();
    if (!toRemove.isEmpty()) {
      removedSummaries =
          userRepository.findByIds(new ArrayList<>(toRemove)).stream()
              .map(u -> new UserSummary(u.id(), u.username(), u.name()))
              .toList();
    }

    for (Long uid : toAdd) repo.add(issue.id(), uid, callerId);
    for (Long uid : toRemove) repo.remove(issue.id(), uid);

    // 4) history — diff 0 이면 미기록
    if (!toAdd.isEmpty() || !toRemove.isEmpty()) {
      List<UserSummary> addedSummaries = List.of();
      if (!toAdd.isEmpty()) {
        addedSummaries =
            userRepository.findByIds(new ArrayList<>(toAdd)).stream()
                .map(u -> new UserSummary(u.id(), u.username(), u.name()))
                .toList();
      }
      historyRecorder.recordAssigneesChanged(
          callerId, issue.id(), addedSummaries, removedSummaries);
    }

    // 5) 신규 추가 사용자 watcher 자동 등록
    for (Long uid : toAdd) watcherAutoEnroller.enroll(issue.id(), uid);

    return repo.findByIssue(issue.id());
  }
}
