package com.workplace.issue.service;

import com.workplace.global.dto.UserSummary;
import com.workplace.issue.dto.IssueHistoryEventType;
import com.workplace.issue.dto.IssueRow;
import com.workplace.issue.dto.IssueStatuses;
import com.workplace.issue.exception.InvalidAssigneeForProjectException;
import com.workplace.issue.exception.IssueAssigneeAgentRestrictionException;
import com.workplace.issue.exception.IssueNotFoundException;
import com.workplace.issue.outbound.IssueChangeNotifier;
import com.workplace.issue.outbound.IssueDomainEvents.IssueAssignedEvent;
import com.workplace.issue.repository.IssueAssigneeRepository;
import com.workplace.issue.repository.IssueHistoryRepository;
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
  private final IssueHistoryRepository historyRepository;

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
    // 이슈 행을 잠가 같은 이슈의 담당자 교체를 한 줄로 세운다 — 두 요청이 같은 "빈 담당자" 를 읽고 각자 넣으면 AI 자기 배정의
    // "혼자 맡기" 규칙이 깨져 담당자가 둘이 된다(WP-375). 부모 변경(setParent·setType)도 같은 행을 잠근 채 읽으므로 판정 중 부모가 바뀌지
    // 않는다.
    var issue =
        issueRepository
            .findByProjectAndNumberForUpdate(project.id(), number)
            .orElseThrow(() -> new IssueNotFoundException(projectKey, number));

    List<Long> normalized = userIds == null ? List.of() : userIds;

    // 1) 담당자 검증 — 개인·팀 공통으로 프로젝트 멤버만 담당 가능 (정책 통일 #418)
    if (!normalized.isEmpty()) {
      Set<Long> allowed = AssigneePolicy.allowedAssigneeIds(project, memberRepository);
      if (!allowed.containsAll(normalized)) {
        throw new InvalidAssigneeForProjectException();
      }
    }

    // 1-b) AGENT 호출자 — "자기 자신만 제거" 또는 "내가 맡은 이슈의 빈 하위 항목을 자기 혼자 맡기"(WP-375) 외 변경 금지 (Phase 5c-2)
    var callerUser =
        userRepository
            .findById(callerId)
            .orElseThrow(() -> new IllegalStateException("caller user 없음: " + callerId));
    if ("AGENT".equals(callerUser.kind())) {
      Set<Long> currentSet = new HashSet<>(repo.findUserIdsByIssue(issue.id()));
      Set<Long> targetSet = new HashSet<>(normalized);
      if (!isSelfRemoval(currentSet, targetSet, callerId)
          && !isSelfClaimOfChild(issue, currentSet, targetSet, callerId)) {
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

  /** 새 집합 = 현재 집합 − 호출자(자기 제거). */
  private static boolean isSelfRemoval(Set<Long> current, Set<Long> target, long callerId) {
    Set<Long> currentMinusSelf = new HashSet<>(current);
    currentMinusSelf.remove(callerId);
    return target.equals(currentMinusSelf);
  }

  /**
   * AI 구성원이 자기가 맡은 이슈의 바로 아래 빈 하위 항목을 혼자 맡는지(WP-375 §3.5). 담당자가 비어 있고, 열려 있고, 새 집합이 {호출자}이고, 바로 위
   * 부모의 담당자에 호출자가 있어야 한다. 손자는 자식을 먼저 맡아야 이 규칙을 통과한다(한 단계씩).
   *
   * <ul>
   *   <li>부모 관계는 사람이 만든 것만 근거로 친다 — 마지막 부모 변경자가 AI(자신이든 다른 AI 든)면 거부한다. 아무 빈 이슈나 AI 이슈 아래로 옮긴 뒤 맡는
   *       우회를 막는다. AI 가 자기 이슈 아래에 새로 만든 하위 항목은 부모 변경 이력이 없어 맡을 수 있다(새 작업이므로 의도).
   *   <li>부모 행을 공유 잠금한 뒤 부모 담당자를 읽는다 — 동시에 부모에서 이 AI 를 빼는 교체가 끼어들지 못한다. 잠금 순서는 항상 자식(replace 가 잠근 이
   *       이슈) → 부모다.
   * </ul>
   */
  private boolean isSelfClaimOfChild(
      IssueRow issue, Set<Long> current, Set<Long> target, long callerId) {
    if (!current.isEmpty() || !target.equals(Set.of(callerId))) return false;
    if (IssueStatuses.CLOSED.contains(issue.status())) return false;
    Long parentId = issue.parentIssueId();
    if (parentId == null) return false;
    issueRepository.lockForShare(parentId);
    if (!repo.findUserIdsByIssue(parentId).contains(callerId)) return false;
    return historyRepository
        .findLastActorKind(issue.id(), IssueHistoryEventType.PARENT_CHANGED.name())
        .map(kind -> !"AGENT".equals(kind))
        .orElse(true);
  }
}
