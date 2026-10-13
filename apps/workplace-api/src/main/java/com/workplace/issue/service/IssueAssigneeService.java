package com.workplace.issue.service;

import com.workplace.global.dto.UserSummary;
import com.workplace.issue.exception.InvalidAssigneeForProjectException;
import com.workplace.issue.exception.IssueAssigneeAgentRestrictionException;
import com.workplace.issue.exception.IssueNotFoundException;
import com.workplace.issue.outbound.IssueChangeNotifier;
import com.workplace.issue.outbound.IssueDomainEvents.IssueAssignedEvent;
import com.workplace.issue.repository.IssueAssigneeRepository;
import com.workplace.issue.repository.IssueRepository;
import com.workplace.project.repository.ProjectMemberRepository;
import com.workplace.project.service.ProjectAccessGuard;
import com.workplace.user.dto.AssigneeInfo;
import com.workplace.user.dto.UserResponse;
import com.workplace.user.repository.UserRepository;
import com.workplace.watcher.service.WatcherAutoEnroller;
import java.time.Instant;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import lombok.RequiredArgsConstructor;
import org.springframework.context.ApplicationEventPublisher;
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
  private final ApplicationEventPublisher publisher;
  private final IssueChangeNotifier changeNotifier;
  private final AgentWorkService agentWorkService;

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

    // 1) 담당자 검증 — 개인·팀 공통으로 프로젝트 멤버만 담당 가능 (정책 통일 #418)
    if (!normalized.isEmpty()) {
      Set<Long> allowed = AssigneePolicy.allowedAssigneeIds(project, memberRepository);
      if (!allowed.containsAll(normalized)) {
        throw new InvalidAssigneeForProjectException();
      }
    }

    // 1-b) AGENT 호출자는 "자기 자신만 제거" 외 변경 금지 (Phase 5c-2)
    var callerUser =
        userRepository
            .findById(callerId)
            .orElseThrow(() -> new IllegalStateException("caller user 없음: " + callerId));
    if ("AGENT".equals(callerUser.kind())) {
      Set<Long> currentSet = new HashSet<>(repo.findUserIdsByIssue(issue.id()));
      Set<Long> targetSet = new HashSet<>(normalized);
      Set<Long> currentMinusSelf = new HashSet<>(currentSet);
      currentMinusSelf.remove(callerId);
      if (!targetSet.equals(currentMinusSelf)) {
        throw new IssueAssigneeAgentRestrictionException();
      }
    }

    // 2) diff 계산
    Set<Long> current = new HashSet<>(repo.findUserIdsByIssue(issue.id()));
    Set<Long> target = new HashSet<>(normalized);
    Set<Long> toAdd = new HashSet<>(target);
    toAdd.removeAll(current);
    Set<Long> toRemove = new HashSet<>(current);
    toRemove.removeAll(target);

    // 2-b) 신규 추가 대상 중 비활성화(is_active=false)된 사용자는 담당자로 지정 불가 (#624)
    // 추가 대상 사용자는 한 번만 읽어 비활성 검사·외부 AI 작업 생성·이력 요약에 함께 쓴다.
    List<AssigneeInfo> addedUsers = userRepository.findAssigneeInfos(toAdd);
    if (addedUsers.stream().anyMatch(u -> !u.isActive())) {
      throw new InvalidAssigneeForProjectException();
    }

    // 3) 제거 대상의 사용자 요약을 먼저 조회 (삭제 후에는 USER JOIN 으로 못 가져옴)
    List<UserSummary> removedSummaries = List.of();
    if (!toRemove.isEmpty()) {
      removedSummaries =
          userRepository.findByIds(new ArrayList<>(toRemove)).stream()
              .map(UserResponse::toSummary)
              .toList();
    }

    for (Long uid : toAdd) repo.add(issue.id(), uid, callerId);
    for (Long uid : toRemove) repo.remove(issue.id(), uid);
    // 외부 실행 AI 구성원이 새로 담당자가 되면 "시작 전" 작업을 만든다(WP-377) — 종료 이슈는 서비스가 거른다.
    agentWorkService.submitForAssignees(issue.id(), issue.status(), addedUsers);
    // 담당에서 빠진 사람의 AI 작업은 끝낸다(WP-377 §4.3) — 변경 알림 전에 닫아 화면 갱신이 최신 상태를 보게 한다.
    if (!toRemove.isEmpty()) {
      agentWorkService.cancelForWorkers(issue.id(), toRemove);
    }

    // 4) history — diff 0 이면 미기록
    List<UserSummary> addedSummaries = List.of();
    if (!toAdd.isEmpty() || !toRemove.isEmpty()) {
      addedSummaries = addedUsers.stream().map(AssigneeInfo::toSummary).toList();
      historyRecorder.recordAssigneesChanged(
          callerId, issue.id(), addedSummaries, removedSummaries);
      // 실시간 무효화 — diff 가 있을 때만
      changeNotifier.updated(project, number, issue.id(), callerId);
    }

    // 5) 신규 추가 사용자 watcher 자동 등록
    for (Long uid : toAdd) watcherAutoEnroller.enroll(issue.id(), uid, callerId);

    // 6) 변경이 있을 때만 도메인 이벤트 발행 (AFTER_COMMIT 에서 ai-agent 발사 후보)
    if (!toAdd.isEmpty() || !toRemove.isEmpty()) {
      var actor = userRepository.findById(callerId).map(UserResponse::toSummary).orElse(null);
      var currentAssignees = repo.findByIssue(issue.id());
      String issueKey = project.key() + "-" + issue.number();
      publisher.publishEvent(
          new IssueAssignedEvent(
              issue.id(),
              project.key(),
              issueKey,
              issue.title(),
              actor,
              currentAssignees,
              addedSummaries,
              removedSummaries,
              Instant.now()));
    }

    return repo.findByIssue(issue.id());
  }
}
