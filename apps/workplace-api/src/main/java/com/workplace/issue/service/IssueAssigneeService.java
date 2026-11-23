package com.workplace.issue.service;

import com.workplace.global.dto.UserSummary;
import com.workplace.global.tenant.TenantContext;
import com.workplace.issue.dto.IssueRow;
import com.workplace.issue.exception.IssueNotFoundException;
import com.workplace.issue.outbound.IssueChangeNotifier;
import com.workplace.issue.outbound.IssueDomainEvents.IssueAssignedEvent;
import com.workplace.issue.repository.IssueAssigneeRepository;
import com.workplace.issue.repository.IssueRepository;
import com.workplace.issue.workflow.service.WorkflowAgentWorkBridge;
import com.workplace.project.dto.ProjectRow;
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
 *
 * <p>호출자가 사람이든 AI 든 같은 규칙을 따른다(WP-453) — AI 도 사람처럼 다른 구성원(사람·AI)을 담당자로 넣고 뺄 수 있다. 할 수 있는지는 역할
 * 권한(issue:write)이 정하고, 담당 변경 이유를 댓글로 남기는 것은 AI 쪽 작업 규칙(work-loop)이 맡는다.
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
  // 워크플로우 프로젝트·이슈 판정(WP-1986) — 다리는 담당 지정 서비스에 의존하지 않으므로 순환이 없다.
  private final WorkflowAgentWorkBridge workflowBridge;

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
    return replace(callerId, projectKey, number, userIds, true);
  }

  /**
   * 담당자 교체 — {@code wakeAgent=false} 면 담당 변경 이벤트(IssueAssignedEvent)는 그대로 내되 ai-agent
   * issue.assigned 실행만 건너뛰게 표시한다(챗 스레드 멤버 반영·배정 알림은 같다). 이력·워처·실시간 갱신·외부 AI 작업 기록도 같다. 반복 AI
   * 작업(WP-989)이 저장할 때 비서를 담당에 넣는 경로처럼, 담당 지정이 「지금 이 이슈를 시작하라」는 뜻이 아닐 때 쓴다(그 AI 는 반복 회차 이벤트로만 일한다).
   */
  public List<UserSummary> replace(
      Long callerId, String projectKey, int number, List<Long> userIds, boolean wakeAgent) {
    var project = accessGuard.assertMember(projectKey, callerId);
    // 이슈 행을 잠가 같은 이슈의 담당자 교체를 한 줄로 세운다 — 동시 교체가 서로의 diff·이력을 덮어쓰지 않게 한다.
    var issue =
        issueRepository
            .findByProjectAndNumberForUpdate(project.id(), number)
            .orElseThrow(() -> new IssueNotFoundException(projectKey, number));

    List<Long> normalized = userIds == null ? List.of() : userIds;

    // 1) 담당자 검증 — 개인·팀 공통으로 프로젝트 멤버만 담당 가능 (정책 통일 #418)
    if (!normalized.isEmpty()) {
      AssigneePolicy.requireMembers(project, normalized, memberRepository);
    }

    // 2) diff 계산
    Set<Long> current = new HashSet<>(repo.findUserIdsByIssue(issue.id()));
    Set<Long> target = new HashSet<>(normalized);
    Set<Long> toAdd = new HashSet<>(target);
    toAdd.removeAll(current);
    Set<Long> toRemove = new HashSet<>(current);
    toRemove.removeAll(target);

    writeDiff(callerId, project, issue, toAdd, toRemove, wakeAgent, true);

    return repo.findByIssue(issue.id());
  }

  /**
   * 워크플로우 이동의 담당 변경(WP-1985) — 호출자가 이슈 행을 잠근 트랜잭션 안에서, 쓰기 권한을 본 뒤 부른다. 구성원·활성 검사, 이력, 워처, 갱신 알림, 담당
   * 변경 이벤트는 {@link #replace} 와 같고, 내부 AI 실행(이벤트 wakeAgent=false)과 agent_work 생성·종료만 하지 않는다(설계 §3
   * B).
   *
   * <p>add 는 지금 담당이 아닌 사람만, remove 는 지금 담당인 사람만 실제로 반영한다 — diff 가 0 이면 {@code replace} 처럼
   * 이력·알림·이벤트가 없다(단계 화면 새로고침용 알림은 호출자가 낸다). 프로젝트 구성원 검사는 새로 넣는 사람만 본다 — 지금 담당 중 프로젝트를 떠난 사람이 있어도
   * 이동이 막히지 않게.
   *
   * <p>잠금 순서(이슈 → 구성원 → 실행): 넣는 사람의 구성원 행을 여기서 잠그므로, 실행 서비스는 이 메서드를 실행 행 revision 갱신·node_run 쓰기보다
   * 먼저 부른다.
   *
   * @throws IllegalArgumentException add 와 remove 에 같은 사람이 있을 때(호출자의 계산 오류)
   * @throws com.workplace.issue.exception.InvalidAssigneeForProjectException 새로 넣는 사람이 프로젝트 구성원이 아닐
   *     때
   * @throws com.workplace.issue.exception.InactiveAssigneeException 새로 넣는 사람이 이 워크스페이스에서 활성이 아닐 때
   */
  public void applyWorkflowChange(
      long callerId, ProjectRow project, IssueRow lockedIssue, Set<Long> add, Set<Long> remove) {
    Set<Long> overlap = new HashSet<>(add);
    overlap.retainAll(remove);
    if (!overlap.isEmpty()) {
      throw new IllegalArgumentException("같은 사람을 담당에 넣고 빼려 했습니다: " + overlap);
    }
    // 지금 담당 기준으로 실제 diff 를 만든다 — 이미 담당인 사람을 다시 넣거나, 담당이 아닌 사람을 빼는 것은 아무 일도 아니다.
    Set<Long> current = new HashSet<>(repo.findUserIdsByIssue(lockedIssue.id()));
    Set<Long> toAdd = new HashSet<>(add);
    toAdd.removeAll(current);
    Set<Long> toRemove = new HashSet<>(remove);
    toRemove.retainAll(current);
    if (!toAdd.isEmpty()) {
      AssigneePolicy.requireMembers(project, toAdd, memberRepository);
    }
    writeDiff(callerId, project, lockedIssue, toAdd, toRemove, false, false);
  }

  /**
   * 계산한 담당 diff 를 쓰고 부수효과를 낸다 — {@link #replace} 와 {@link #applyWorkflowChange} 가 같은 순서(활성 검사 → 쓰기
   * → agent_work → 이력·갱신 알림 → 워처 → 이벤트)를 쓰게 한 곳에 둔다.
   *
   * @param wakeAgent 담당 변경 이벤트에 실을 값 — false 면 ai-agent issue.assigned 발사만 건너뛴다
   * @param manageAgentWork 외부 AI 의 "시작 전" 작업 생성과 빠진 사람의 작업 종료를 할지 — 워크플로우 경로는 false
   */
  private void writeDiff(
      Long callerId,
      ProjectRow project,
      IssueRow issue,
      Set<Long> toAdd,
      Set<Long> toRemove,
      boolean wakeAgent,
      boolean manageAgentWork) {
    // 2-b) 신규 추가 대상은 이 워크스페이스에서 활성이어야 한다 — 전역 비활성(#624)·워크스페이스 정지(WP-417) 모두 거부. 이슈 생성과 같은
    // 규칙(AssigneePolicy). 기존 담당자는 유지(제거만 허용)하도록 추가분만 본다.
    // 추가 대상 사용자는 한 번만 읽어 활성 검사·외부 AI 작업 생성·이력 요약에 함께 쓴다. 테넌트는 요청 컨텍스트(이 프로젝트는 RLS 로 그
    // 테넌트 것만 보인다) — 컨텍스트 없는 내부 호출이면 findAssigneeInfos 가 전역 활성만 본다.
    List<AssigneeInfo> addedUsers = userRepository.findAssigneeInfos(toAdd, TenantContext.get());
    AssigneePolicy.requireActive(addedUsers);

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
    // 워크플로우가 맡는 이슈의 담당 지정은 깨우지 않는다(WP-1986 설계 §5-3·§9-4) — 활성 실행이 있는 이슈이거나, 켜고 게시한 정의 중 하나가 교체
    // 뒤의 담당으로 시작될 수 있는(시작 조건이 맞는) 이슈면 AI 를 깨우는 것은 노드 진입(시작·이동)이고, 사람이 담당을 넣는 것은 「시작하라」가 아니다.
    // 그래서 깨우기 표시를 끄고 「시작 전」 작업도 열지 않는다. 담당 변경 이벤트(ASSIGNED 알림)와 해제의 작업 취소는 그대로다. 어떤 정의도 시작할 수
    // 없는 이슈는 워크플로우가 깨울 일이 없어 지금처럼 깨운다(코드 리뷰 I4 — 프로젝트 전체 억제를 좁힘). 깨울 교체(REST·claim·MCP)에서 새로 넣는
    // 사람이 있을 때만 판정해, 깨우지 않는 교체(반복 AI 작업 저장)와 켜지 않은 프로젝트의 동작은 그대로 둔다.
    boolean openSubmitted = true;
    if (manageAgentWork
        && wakeAgent
        && !toAdd.isEmpty()
        && (workflowBridge.isWorkflowIssue(issue.id())
            || workflowBridge.couldStartFor(project.id(), repo.findUserIdsByIssue(issue.id())))) {
      wakeAgent = false;
      openSubmitted = false;
    }
    // 워크플로우 경로(manageAgentWork=false, WP-1985)는 agent_work 를 만들거나 닫지 않는다 — 이동으로 바뀐 담당의 작업 상태는
    // WP-1986 이 맡는다. 반복 회수도 cancelForWorkers 안에 있어 함께 건너뛴다 — AI 작업 수명은 WP-1986 몫이고, 회차 발행이 담당
    // 여부를 확인하므로 빠진 AI 의 반복이 실제로 돌지는 않는다.
    if (manageAgentWork) {
      // 외부 실행 AI 구성원이 새로 담당자가 되면 "시작 전" 작업을 만든다(WP-377) — 종료 이슈는 서비스가 거른다.
      if (openSubmitted) {
        agentWorkService.submitForAssignees(issue.id(), issue.status(), addedUsers);
      }
      // 담당에서 빠진 사람의 AI 작업은 끝낸다(WP-377 §4.3) — 변경 알림 전에 닫아 화면 갱신이 최신 상태를 보게 한다.
      if (!toRemove.isEmpty()) {
        agentWorkService.cancelForWorkers(issue.id(), toRemove);
      }
    }

    // 4) history — diff 0 이면 미기록
    List<UserSummary> addedSummaries = List.of();
    if (!toAdd.isEmpty() || !toRemove.isEmpty()) {
      addedSummaries = addedUsers.stream().map(AssigneeInfo::toSummary).toList();
      historyRecorder.recordAssigneesChanged(
          callerId, issue.id(), addedSummaries, removedSummaries);
      // 담당자만 바뀌어도 이슈 수정 시각을 올린다 — 최근 수정 순 정렬·최근 변동에 반영(WP-1930). version 은 그대로.
      issueRepository.touchUpdatedAt(issue.id());
      // 실시간 무효화 — diff 가 있을 때만
      changeNotifier.updatedWithoutTouch(project, issue.number(), issue.id(), callerId);
    }

    // 5) 신규 추가 사용자 watcher 자동 등록
    for (Long uid : toAdd) watcherAutoEnroller.enroll(project, issue.id(), uid, callerId);

    // 6) 변경이 있을 때만 도메인 이벤트 발행 (AFTER_COMMIT 에서 ai-agent 발사 후보) — 깨우지 않는 교체는 wakeAgent=false 로 실어
    //    ai-agent 발사만 막는다. 이벤트 자체를 빼면 챗 스레드 멤버 반영·배정 알림까지 빠진다.
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
              Instant.now(),
              wakeAgent));
    }
  }
}
