package com.workplace.project.service;

import static com.workplace.global.realtime.ResourceChangedEvent.OP_CREATED;
import static com.workplace.global.realtime.ResourceChangedEvent.OP_DELETED;
import static com.workplace.global.realtime.ResourceChangedEvent.OP_UPDATED;

import com.workplace.global.share.ProjectMembership;
import com.workplace.global.tenant.TenantContext;
import com.workplace.project.dto.ProjectMemberGroupResponse;
import com.workplace.project.dto.ProjectRow;
import com.workplace.project.exception.ProjectConflictException;
import com.workplace.project.exception.ProjectNotFoundException;
import com.workplace.project.outbound.ProjectChangeNotifier;
import com.workplace.project.repository.ProjectMemberGroupRepository;
import com.workplace.project.repository.ProjectMemberRepository;
import com.workplace.project.repository.ProjectRepository;
import com.workplace.user.outbound.DepartmentMembersGrown;
import com.workplace.user.outbound.DepartmentMembersReduced;
import com.workplace.user.outbound.WorkspaceMembershipSuspended;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.stream.Collectors;
import lombok.RequiredArgsConstructor;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.context.event.EventListener;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.event.TransactionPhase;
import org.springframework.transaction.event.TransactionalEventListener;

/**
 * 팀 프로젝트 멤버로 둔 조직도 부서(WP-1057) — 부서 자체를 프로젝트 멤버로 둔다. 그 부서와 하위 부서의 활성 사람 구성원이 MEMBER 로 들어오고, 소속은 판정할
 * 때마다 다시 본다(공용 {@link ProjectMembership}). 사람의 실효 역할은 직접 멤버 역할과 부서(MEMBER) 중 높은 것이다. 노트 스페이스의
 * {@code WikiSpaceMemberGroupService}(WP-1052)와 같은 짜임이다.
 *
 * <p>규칙: 팀 프로젝트(TEAM·OPEN)에만(개인 프로젝트는 AI 만 멤버), 조직도 부서(SHARED)만, 역할은 MEMBER 고정(멤버 관리·프로젝트 설정 권한
 * OWNER 는 사람에게만 — 마지막 소유자 보호도 직접 멤버 행만 본다). 권한은 사람 멤버 API 와 같다(조회는 읽을 수 있는 사람, 변경은 OWNER).
 *
 * <p>사람이 실효 멤버가 아니게 되면(부서 행 제거, 부서에서 빠짐·부서 삭제·이동, 구성원 정지 — 직접 행이나 다른 부서로 여전히 멤버가 아닐 때) 멤버 제거와 같이
 * 정리한다({@link ProjectMemberDeparture}): 담당 해제와 이력, AI 작업 취소, 워처·이슈 대화 명단 정리, 실시간 알림.
 */
@Service
@RequiredArgsConstructor
public class ProjectMemberGroupService {

  private final ProjectAccessGuard accessGuard;
  private final ProjectRepository projectRepository;
  private final ProjectMemberRepository memberRepository;
  private final ProjectMemberGroupRepository groups;
  private final ProjectMemberDeparture departure;
  private final ProjectChangeNotifier changeNotifier;
  private final ApplicationEventPublisher publisher;

  /** 프로젝트 멤버 부서 목록(이름순, 부서마다 들어오는 사람 수) — 사람 멤버 목록과 같이 읽을 수 있으면 볼 수 있다. */
  @Transactional(readOnly = true)
  public List<ProjectMemberGroupResponse> list(Long callerId, String projectKey) {
    ProjectRow project = accessGuard.assertReadable(projectKey, callerId);
    return groups.list(project.id());
  }

  /**
   * 조직도 부서를 멤버로 더한다(OWNER). 역할은 MEMBER 만 받는다.
   *
   * @throws IllegalArgumentException MEMBER 가 아닌 역할, 조직도 부서가 아닌 그룹(개인 그룹·없는 그룹·다른 워크스페이스) — 400
   * @throws ProjectConflictException 개인 프로젝트, 이미 멤버인 부서 — 409
   */
  @Transactional
  public ProjectMemberGroupResponse add(
      Long callerId, String projectKey, long groupId, String role) {
    ProjectRow project = accessGuard.assertWithRole(projectKey, callerId, "OWNER");
    if (role != null && !ProjectMembership.GROUP_ROLE.equals(role)) {
      throw new IllegalArgumentException("부서에는 멤버 역할만 줄 수 있습니다");
    }
    requireTeamProject(project);
    // 노트 스페이스 멤버 부서와 같은 검증·문구 — 개인 그룹은 조건으로, 다른 워크스페이스 그룹은 RLS 로 빠진다.
    if (groups.findDepartmentName(groupId).isEmpty()) {
      throw new IllegalArgumentException("조직도 부서만 지정할 수 있습니다");
    }
    if (groups.exists(project.id(), groupId)) {
      throw new ProjectConflictException("이미 멤버인 부서입니다");
    }
    groups.insert(project.id(), groupId, callerId);
    // 들어오는 사람만 늘어 정리할 사람은 없다 — 멤버 창·사이드바·후보 목록이 다시 받게만 알린다. ids 가 부서 id 라 사용자 id 를 싣는
    // project-member 가 아니라 부서 행 리소스로 낸다.
    changeNotifier.changed(
        ProjectChangeNotifier.RESOURCE_PROJECT_MEMBER_GROUP,
        OP_CREATED,
        project,
        groupId,
        callerId);
    return groups.find(project.id(), groupId).orElseThrow(ProjectNotFoundException::hidden);
  }

  /**
   * 멤버 부서를 뺀다(OWNER). 빠지기 전 부서로 들어오던 사람 중 이제 실효 멤버가 아닌 사람(직접 행·다른 부서로 남지 않은 사람)을 멤버 제거와 같이 정리한다.
   * 빠지기 전 명단 전원을 변경 알림의 추가 수신자로 넘긴다 — 부서로만 들어와 있던 사람은 커밋 뒤 멤버 명단에서 빠지므로 자기 화면에서도 프로젝트가 사라지게.
   *
   * @throws ProjectNotFoundException 이 프로젝트의 멤버 부서가 아님(404 — 사람 멤버 제거와 같은 응답)
   */
  @Transactional
  public void remove(Long callerId, String projectKey, long groupId) {
    ProjectRow project = accessGuard.assertWithRole(projectKey, callerId, "OWNER");
    // 없는 부서 행(두 번 누르기 등)이면 부서 구성원 전원을 모으는 무거운 조회 전에 404 로 끝낸다(WP-1129).
    if (!groups.exists(project.id(), groupId)) {
      throw new ProjectNotFoundException("멤버 부서 없음");
    }
    Set<Long> before = memberRepository.findDepartmentUserIds(project.id());
    // 확인과 지우기 사이에 다른 요청이 먼저 지웠으면 그대로 404.
    if (groups.delete(project.id(), groupId) == 0) {
      throw new ProjectNotFoundException("멤버 부서 없음");
    }
    // 빠진 사람은 project-member/deleted 한 번(사용자 id 목록)으로, 부서 행 변경은 부서 행 리소스로 따로 알린다.
    departure.cleanupIfGone(project, before, callerId);
    changeNotifier.changed(
        ProjectChangeNotifier.RESOURCE_PROJECT_MEMBER_GROUP,
        OP_DELETED,
        project,
        groupId,
        callerId,
        before);
  }

  /**
   * 조직도 부서의 구성원이 줄었거나 부서가 사라졌다(WP-1042 이벤트) — 그 부서(이벤트에 상위 부서도 담겨 온다)를 멤버로 둔 프로젝트마다 지금 부서로 들어오는 사람을
   * 모아 둔다. 동기 리스너라 변경 <b>전</b>에 돈다: 부서를 지우면 멤버 부서 행이 CASCADE 로 사라지므로 영향받는 프로젝트와 명단을 여기서 모은다. 명단은
   * 프로젝트마다 따로 재귀 조회하지 않고 한 번에 모은다(조직도 쓰기 트랜잭션 안이다). 정리는 변경이 반영된 뒤(커밋 직전) {@link
   * #onDepartmentAudienceShrunk} 가 한다.
   */
  @EventListener
  public void onDepartmentMembersReduced(DepartmentMembersReduced e) {
    List<Long> projectIds = groups.findProjectIdsByGroups(e.groupIds());
    if (projectIds.isEmpty()) {
      return;
    }
    publisher.publishEvent(
        new ProjectDepartmentAudienceShrunk(
            e.tenantId(),
            e.groupIds(),
            memberRepository.findDepartmentUserIdsByProjects(projectIds)));
  }

  /**
   * 조직도 부서의 구성원이 늘었다(WP-1102 이벤트, WP-1166) — 그 부서(상위 부서도 담겨 온다)를 멤버로 둔 프로젝트마다 부서 행 변경 알림을 낸다. 들어오는
   * 사람만 늘어 정리할 사람은 없다({@link #add} 와 같다) — 멤버 창의 부서 인원·사이드바·후보 목록이 다시 받게만 알린다. 수신자는 커밋 직전에 실효 멤버로
   * 다시 조회되므로 새로 들어온 사람의 화면에도 프로젝트가 나타난다. 알림은 이 동기 리스너에서 낸다 — 커밋 직전 리스너 안에서 낸 변경 알림은 발송기에 닿지 않는다.
   */
  @EventListener
  public void onDepartmentMembersGrown(DepartmentMembersGrown e) {
    TenantContext.runAs(
        e.tenantId(),
        () -> {
          Map<Long, List<Long>> groupsByProject = groups.findGroupIdsByProjectAmong(e.groupIds());
          if (groupsByProject.isEmpty()) {
            return;
          }
          // 프로젝트마다 자기 멤버 부서 id 만 싣는다 — 이벤트의 상위 부서는 그 프로젝트에 없을 수 있다.
          projectRepository
              .findActiveByIdsInOrder(List.copyOf(groupsByProject.keySet()))
              .forEach(
                  p ->
                      changeNotifier.changed(
                          ProjectChangeNotifier.RESOURCE_PROJECT_MEMBER_GROUP,
                          OP_UPDATED,
                          p,
                          groupsByProject.get(p.id()),
                          null,
                          List.of()));
        });
  }

  /**
   * 구성원 정지(WP-420 이벤트) — 정지된 사람은 부서 구성원으로 세어지지 않으므로, 그 사람이 직접 속한 부서(와 상위 부서)를 멤버로 둔 프로젝트에서 이제 실효
   * 멤버가 아니면 멤버 제거와 같이 정리한다. 직접 멤버 행으로 남아 있는 프로젝트는 지금처럼 그대로 둔다(정지는 직접 멤버 행을 지우지 않는다). 정지와 같은 트랜잭션의
   * 커밋 직전에 돈다 — 정지가 반영된 뒤 판정한다. 테넌트는 이벤트에 담긴 값으로 세운다.
   */
  @TransactionalEventListener(phase = TransactionPhase.BEFORE_COMMIT)
  public void onWorkspaceMembershipSuspended(WorkspaceMembershipSuspended e) {
    TenantContext.runAs(
        e.tenantId(),
        () -> {
          Set<Long> user = Set.of(e.userId());
          cleanupGone(
              groups.findProjectIdsReachableByMembership(e.userId()).stream()
                  .collect(
                      Collectors.toMap(id -> id, id -> user, (a, b) -> a, LinkedHashMap::new)));
        });
  }

  /**
   * 부서로 들어오던 사람이 줄었을 수 있는 프로젝트 — 커밋 직전(같은 트랜잭션, 조직도 변경이 반영된 뒤) 변경 전 명단 중 이제 실효 멤버가 아닌 사람을 정리한다. 변경과
   * 정리가 함께 커밋되거나 함께 롤백된다. 테넌트는 이벤트에 담긴 값으로 세운다.
   *
   * <p>빠진 사람이 없어도 영향받은 프로젝트마다 부서 행 변경 알림을 낸다 — 부서 삭제로 부서 행이 CASCADE 로 사라지거나 이동·구성원 감소로 부서 인원이
   * 바뀌었으므로, 열어 둔 멤버 창이 지워진 부서 행(제거하면 404)이나 옛 인원을 보이지 않게.
   */
  @TransactionalEventListener(phase = TransactionPhase.BEFORE_COMMIT)
  public void onDepartmentAudienceShrunk(ProjectDepartmentAudienceShrunk e) {
    TenantContext.runAs(
        e.tenantId(),
        () ->
            cleanupGone(e.before())
                .forEach(
                    p ->
                        changeNotifier.changed(
                            ProjectChangeNotifier.RESOURCE_PROJECT_MEMBER_GROUP,
                            OP_UPDATED,
                            p,
                            e.groupIds(),
                            null,
                            List.of())));
  }

  /**
   * 프로젝트마다 후보 중 이제 실효 멤버가 아닌 사람을 정리하고({@link ProjectMemberDeparture#cleanupIfGone(List, Map,
   * Long)}), 판정한 (지워지지 않은) 프로젝트를 돌려준다. 프로젝트와 실효 멤버 판정을 프로젝트마다 따로 읽지 않고 한 번에 읽는다.
   */
  private List<ProjectRow> cleanupGone(Map<Long, Set<Long>> candidates) {
    if (candidates.isEmpty()) {
      return List.of();
    }
    List<ProjectRow> projects =
        projectRepository.findActiveByIdsInOrder(List.copyOf(candidates.keySet()));
    departure.cleanupIfGone(projects, candidates, null);
    return projects;
  }

  /** 개인 프로젝트에는 부서를 둘 수 없다 — 개인 프로젝트는 비공개라 사람 멤버를 받지 않는다(AI 만). */
  private static void requireTeamProject(ProjectRow project) {
    if ("PERSONAL".equals(project.type())) {
      throw new ProjectConflictException("개인 프로젝트에는 부서를 멤버로 둘 수 없습니다");
    }
  }

  /**
   * 조직도 변경 전 명단(프로젝트 → 부서로 들어오던 사람) — 변경 전 동기 리스너가 모아 커밋 직전 정리에 넘기는 내부 이벤트.
   *
   * @param tenantId 변경이 일어난 워크스페이스
   * @param groupIds 구성원이 줄어든 쪽 조직도 부서 id(원 이벤트 그대로) — 부서 행 변경 알림의 ids
   * @param before 프로젝트 id → 변경 전 부서로 들어오던 사람 id(영향받은 프로젝트는 아무도 없어도 빈 집합으로 담긴다)
   */
  public record ProjectDepartmentAudienceShrunk(
      long tenantId, List<Long> groupIds, Map<Long, Set<Long>> before) {}
}
