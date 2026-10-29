package com.workplace.project.service;

import static com.workplace.global.realtime.ResourceChangedEvent.OP_DELETED;

import com.workplace.global.dto.UserSummary;
import com.workplace.issue.dto.AgentWorkState;
import com.workplace.issue.repository.AgentWorkRepository;
import com.workplace.issue.repository.IssueAssigneeRepository;
import com.workplace.issue.repository.IssueRecurrenceRepository;
import com.workplace.issue.service.IssueHistoryRecorder;
import com.workplace.project.dto.ProjectRow;
import com.workplace.project.outbound.ProjectChangeNotifier;
import com.workplace.project.repository.ProjectMemberRepository;
import com.workplace.user.dto.UserResponse;
import com.workplace.user.repository.UserRepository;
import java.util.Collection;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.stream.Collectors;
import lombok.RequiredArgsConstructor;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

/**
 * 프로젝트에서 빠진 사람 정리(WP-1057) — 「멤버 제거」(#714·WP-488·WP-377·WP-475·WP-476)의 정리를 한 곳에 모았다. 직접 멤버 행 제거뿐
 * 아니라 멤버로 둔 조직도 부서 행 제거, 부서 구성원 감소(조직도에서 빠짐·부서 삭제·이동), 구성원 정지로 <b>실효 멤버가 아니게 된</b> 사람도 똑같이 정리한다:
 *
 * <ul>
 *   <li>그 프로젝트 이슈의 담당자에서 빼고 이슈마다 담당자 변경 이력을 남긴다(행위자 = 변경한 사람)
 *   <li>그 사람의 진행 중 AI 작업을 취소로 끝낸다
 *   <li>project-member/deleted 변경 알림을 (빠진 사람 전원을 담아 한 번) 낸다 — 같은 트랜잭션의 리스너가 워처(WP-476)·이슈 대화
 *       명단(WP-475)을 정리하고, 커밋 뒤 빠진 사람에게도 실시간 알림이 간다
 * </ul>
 *
 * <p>판정은 변경이 반영된 <b>뒤</b>에 한다 — 직접 멤버 행이나 다른 부서로 여전히 실효 멤버인 사람은 건드리지 않는다. 원인이 된 변경과 같은 트랜잭션에서
 * 부른다(함께 커밋되거나 함께 롤백된다).
 */
@Component
@RequiredArgsConstructor
public class ProjectMemberDeparture {

  private final ProjectMemberRepository memberRepository;
  private final IssueAssigneeRepository issueAssigneeRepository;
  private final IssueHistoryRecorder historyRecorder;
  private final AgentWorkRepository agentWorkRepository;
  private final IssueRecurrenceRepository recurrenceRepository;
  private final UserRepository userRepository;
  private final ProjectChangeNotifier changeNotifier;

  /**
   * 후보 중 이제 이 프로젝트의 실효 멤버가 아닌 사람을 정리한다 — 한 프로젝트용 {@link #cleanupIfGone(List, Map, Long)}.
   *
   * @param candidates 빠졌을 수 있는 사람(변경 전 명단 등)
   * @param actorId 이력·알림의 행위자 — null 이면 요청 사용자, 그것도 없으면 이력을 남기지 않는다(issue_history.actor_id 가 NOT
   *     NULL)
   */
  @Transactional(propagation = Propagation.MANDATORY)
  public void cleanupIfGone(ProjectRow project, Collection<Long> candidates, Long actorId) {
    cleanupIfGone(List.of(project), Map.of(project.id(), candidates), actorId);
  }

  /**
   * 프로젝트마다 후보 중 이제 실효 멤버가 아닌 사람을 정리한다. 빠진 사람이 있는 프로젝트마다 그들을 한 번에 담은 project-member/deleted 알림을 하나
   * 낸다. 실효 멤버 판정은 프로젝트마다 따로 읽지 않고 한 번에 읽는다 — 조직도 변경 하나가 여러 프로젝트에 걸려도 조회 수가 늘지 않게.
   *
   * @param projects 정리할 프로젝트(이 순서로 정리한다) — candidates 에 키가 있어야 한다
   * @param candidates 프로젝트 id → 빠졌을 수 있는 사람(정리하지 않을 프로젝트 키가 섞여 있어도 된다)
   * @param actorId 위 한 프로젝트용과 같다
   */
  @Transactional(propagation = Propagation.MANDATORY)
  public void cleanupIfGone(
      List<ProjectRow> projects, Map<Long, ? extends Collection<Long>> candidates, Long actorId) {
    Map<Long, Set<Long>> still = memberRepository.findMemberUserIdsByProjects(candidates);
    for (ProjectRow p : projects) {
      Set<Long> kept = still.get(p.id());
      List<Long> gone =
          candidates.get(p.id()).stream().distinct().filter(id -> !kept.contains(id)).toList();
      cleanup(p, gone, actorId);
    }
  }

  /**
   * 이미 실효 멤버가 아니라고 판정된 사람(gone)을 정리한다 — 빠진 사람 전원의 담당 해제·이력·AI 작업 취소를 한꺼번에 하고(사람 수만큼 조회를 돌리지 않게,
   * WP-1129), 알림은 빠진 사람 전원을 담아 <b>한 번</b> 낸다 (부서 하나가 빠져 수백 명이 나가도 SSE·같은 트랜잭션 리스너가 한 번만 돈다 — 리스너와 웹
   * 규칙은 ids 목록을 그대로 다룬다). 빠진 사람은 커밋 뒤 명단에서 빠지므로 추가 수신자로도 넘긴다.
   */
  private void cleanup(ProjectRow project, List<Long> gone, Long actorId) {
    if (gone.isEmpty()) {
      return;
    }
    Long actor = actorId != null ? actorId : currentUserId();
    unassignAll(project, gone, actor);
    changeNotifier.changed(
        ProjectChangeNotifier.RESOURCE_PROJECT_MEMBER, OP_DELETED, project, gone, actor, gone);
  }

  /** 한 사람의 담당 해제 + 이력 + AI 작업 취소 — 직접 멤버 행 제거가 부른다({@link #unassignAll}). */
  @Transactional(propagation = Propagation.MANDATORY)
  public void unassign(ProjectRow project, Long userId, Long actorId) {
    unassignAll(project, List.of(userId), actorId);
  }

  /**
   * 담당 해제 + 이력 + AI 작업 취소 — 멤버 제거의 담당자 정리 본체. 실효 멤버 여부는 호출자가 판정했다. 담당자가 빠진 이슈별 issue 이벤트는 내지 않는다 —
   * 웹의 project-member 규칙이 이슈 대상을 무효화한다. 사람이 여럿이어도 단계마다 한 문장으로 한다(WP-1129) — 300명 부서가 빠져도 조회 수가 늘지
   * 않게.
   */
  private void unassignAll(ProjectRow project, List<Long> userIds, Long actorId) {
    List<IssueAssigneeRepository.Removed> removed =
        issueAssigneeRepository.removeByProjectAndUsers(project.id(), userIds);
    // 담당자가 빠진 이슈마다(빠진 사람마다) 이력을 남긴다(WP-488) — 조용히 지우면 누가 왜 담당자를 뺐는지 이슈에서 알 수 없다.
    if (!removed.isEmpty() && actorId != null) {
      Map<Long, UserSummary> summaries =
          userRepository
              .findByIds(
                  removed.stream().map(IssueAssigneeRepository.Removed::userId).distinct().toList())
              .stream()
              .collect(Collectors.toMap(UserResponse::id, UserResponse::toSummary));
      historyRecorder.recordAssigneesRemoved(
          actorId,
          removed.stream()
              .filter(r -> summaries.containsKey(r.userId()))
              .map(r -> Map.entry(r.issueId(), summaries.get(r.userId())))
              .toList());
    }
    // 그 AI 가 돌리던 반복도 거둔다(WP-1114) — 회차 시각까지 상세에 「다음 실행 …」이 남지 않게. 결과 보고와 같은 순서(반복 → 작업 기록)로 잠근다.
    // 빠진 (이슈, 사람) 쌍만 — 이슈·사람 목록을 따로 넘기면 곱집합이 되어 남의 반복까지 거둔다.
    recurrenceRepository.retirePairs(
        removed.stream().map(r -> Map.entry(r.issueId(), r.userId())).toList());
    // 담당 매핑이 사라진 이슈에 진행 중 AI 작업이 고아로 남지 않게 함께 끝낸다(WP-377).
    agentWorkRepository.endActiveForWorkersInProject(
        project.id(), userIds, AgentWorkState.CANCELED);
  }

  /** 요청 사용자(인증 주체 id) — 조직도 변경·정지처럼 다른 모듈에서 온 정리의 행위자. 요청 밖이면 null. */
  private static Long currentUserId() {
    Authentication auth = SecurityContextHolder.getContext().getAuthentication();
    return auth != null && auth.getPrincipal() instanceof Long id ? id : null;
  }
}
