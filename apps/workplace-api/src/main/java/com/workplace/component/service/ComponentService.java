package com.workplace.component.service;

import static com.workplace.global.realtime.ResourceChangedEvent.OP_CREATED;
import static com.workplace.global.realtime.ResourceChangedEvent.OP_DELETED;
import static com.workplace.global.realtime.ResourceChangedEvent.OP_UPDATED;

import com.workplace.component.dto.ComponentResponse;
import com.workplace.component.dto.ComponentRow;
import com.workplace.component.dto.CreateComponentRequest;
import com.workplace.component.dto.UpdateComponentRequest;
import com.workplace.component.exception.ComponentException;
import com.workplace.component.repository.ComponentRepository;
import com.workplace.global.dto.UserSummary;
import com.workplace.global.tenant.TenantContext;
import com.workplace.issue.service.IssueHistoryRecorder;
import com.workplace.project.dto.ProjectRow;
import com.workplace.project.outbound.ProjectChangeNotifier;
import com.workplace.project.repository.ProjectMemberRepository;
import com.workplace.project.service.ProjectAccessGuard;
import com.workplace.user.dto.AssigneeInfo;
import com.workplace.user.dto.UserKind;
import com.workplace.user.repository.UserRepository;
import java.util.Collection;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.stream.Collectors;
import lombok.RequiredArgsConstructor;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * 프로젝트 구성요소(WP-933) 목록 관리 서비스. 보기는 프로젝트를 읽을 수 있는 사람, 추가·편집·보관·복원·삭제는 프로젝트 OWNER 와 테넌트 ADMIN 이다 —
 * 담당자를 자동 지정하는 설정이라 라벨(멤버 누구나 생성)보다 좁히며, 이슈 유형 관리와 같은 가드({@code assertWithRole(..., "OWNER")})를 쓴다.
 *
 * <p>이슈에 붙이고 떼는 일과 이슈를 만들 때의 자동 지정은 이슈 쪽 서비스가 한다 — 이 서비스는 목록 관리와, 그 서비스들이 함께 쓰는 담당자 유효성 판정({@link
 * #isAssigneeValid})을 맡는다.
 */
@Service
@Transactional
@RequiredArgsConstructor
public class ComponentService {

  /** 프로젝트당 구성요소 상한(보관 포함). */
  public static final int LIMIT = 100;

  private final ComponentRepository componentRepository;
  private final ProjectAccessGuard accessGuard;
  private final ProjectMemberRepository memberRepository;
  private final UserRepository userRepository;
  private final IssueHistoryRecorder historyRecorder;
  private final ProjectChangeNotifier changeNotifier;

  /** 목록(보관 포함, 목록 순서) — 프로젝트를 읽을 수 있으면 누구나. 항목마다 담당자 유효 여부와 이슈 수를 함께 준다. */
  @Transactional(readOnly = true)
  public List<ComponentResponse> list(Long callerId, String projectKey) {
    var project = accessGuard.assertReadable(projectKey, callerId);
    return toResponses(project, componentRepository.listByProject(project.id()));
  }

  /** 구성요소 추가 — OWNER·ADMIN. 개인 프로젝트·상한·이름 중복·담당자 무효는 400. */
  public ComponentResponse create(Long callerId, String projectKey, CreateComponentRequest req) {
    var project = accessGuard.assertWithRole(projectKey, callerId, "OWNER");
    if (project.isPersonal()) {
      throw ComponentException.personalProject();
    }
    // 개수 검사와 삽입 사이에 다른 추가가 끼어 상한을 넘기지 않게 프로젝트 단위로 직렬화한다.
    componentRepository.lockProject(project.id());
    if (componentRepository.countByProject(project.id()) >= LIMIT) {
      throw ComponentException.limit(LIMIT);
    }
    assertNameFree(project.id(), req.name(), null);
    if (req.defaultAssigneeId() != null) {
      requireValidAssignee(project, req.defaultAssigneeId());
    }
    try {
      var row =
          componentRepository.insert(
              project.id(), req.name(), req.description(), req.defaultAssigneeId(), callerId);
      // 다른 탭·다른 멤버 화면의 구성요소 목록(설정·피커·필터)이 새 항목을 다시 읽게 알린다(라벨과 같은 방식).
      changeNotifier.changed(
          ProjectChangeNotifier.RESOURCE_COMPONENT, OP_CREATED, project, row.id(), callerId);
      return toResponses(project, List.of(row)).get(0);
    } catch (DuplicateKeyException e) {
      throw ComponentException.nameTaken(req.name());
    }
  }

  /**
   * 부분 수정 — OWNER·ADMIN. 보낸 필드만 바꾼다(이름·설명·담당자·보관 여부). 대상 행을 잠그고 읽어 같은 구성요소의 동시 변경과 겹치지 않게 한다. 담당자를
   * 새로 지정할 때만 유효성을 본다 — 이름만 바꾸는 요청이 이미 무효가 된 기존 담당자 때문에 막히지 않게.
   */
  public ComponentResponse update(
      Long callerId, String projectKey, long componentId, UpdateComponentRequest req) {
    var project = accessGuard.assertWithRole(projectKey, callerId, "OWNER");
    ComponentRow row = findInProject(project, componentId, true);
    String name = row.name();
    if (req.name() != null && !req.name().equals(row.name())) {
      // 대소문자만 바꾸는 이름 변경은 자기 자신을 제외하고 비교하므로 허용된다.
      assertNameFree(project.id(), req.name(), componentId);
      name = req.name();
    }
    String description =
        req.description() == null
            ? row.description()
            : (req.description().isEmpty() ? null : req.description());
    Long assigneeId = row.defaultAssigneeId();
    if (Boolean.TRUE.equals(req.clearDefaultAssignee())) {
      assigneeId = null;
    } else if (req.defaultAssigneeId() != null) {
      requireValidAssignee(project, req.defaultAssigneeId());
      assigneeId = req.defaultAssigneeId();
    }
    boolean archived = req.archived() == null ? row.archived() : req.archived();
    try {
      componentRepository.update(componentId, name, description, assigneeId, archived);
    } catch (DuplicateKeyException e) {
      throw ComponentException.nameTaken(name);
    }
    // 이름·보관 변경은 이슈 칩에도 보이므로 열린 화면이 목록과 이슈를 함께 다시 읽게 알린다.
    changeNotifier.changed(
        ProjectChangeNotifier.RESOURCE_COMPONENT, OP_UPDATED, project, componentId, callerId);
    return toResponses(
            project,
            List.of(
                componentRepository
                    .findById(componentId)
                    .orElseThrow(ComponentException::notFound)))
        .get(0);
  }

  /** 이 구성요소가 붙은 (삭제되지 않은) 이슈 수 — 삭제 확인창의 영향 안내. 목록과 같은 읽기 권한. */
  @Transactional(readOnly = true)
  public int issueCount(Long callerId, String projectKey, long componentId) {
    var project = accessGuard.assertReadable(projectKey, callerId);
    return componentRepository.countLiveIssues(findInProject(project, componentId, false).id());
  }

  /**
   * 삭제 — OWNER·ADMIN. 붙어 있던 이슈마다 「구성요소 제거」 이력을 남긴다(라벨 삭제와 같은 방식) — cascade 로 조용히 빠지면 이슈에서 이유를 알 수
   * 없다. 행을 잠근 채 붙은 이슈를 읽고 지우므로, 그 사이 새로 붙이려던 요청은 삭제가 끝난 뒤 외래키 위반으로 실패하고 기록 없이 사라지는 연결은 생기지 않는다.
   */
  public void delete(Long callerId, String projectKey, long componentId) {
    var project = accessGuard.assertWithRole(projectKey, callerId, "OWNER");
    ComponentRow row = findInProject(project, componentId, true);
    var summary = row.toSummary();
    for (Long issueId : componentRepository.findIssueIdsByComponent(componentId)) {
      historyRecorder.recordComponentsChanged(callerId, issueId, List.of(), List.of(summary));
    }
    componentRepository.delete(componentId);
    changeNotifier.changed(
        ProjectChangeNotifier.RESOURCE_COMPONENT, OP_DELETED, project, componentId, callerId);
  }

  /**
   * 자동 지정·설정 경고가 쓰는 담당자 유효성 — 프로젝트 멤버이고 이 워크스페이스에서 활성이며 사람(HUMAN)인가. AI 는 담당자로 들어가는 순간 작업이 시작되는
   * 부작용이 있어 제외한다. 값 자체는 남기고 판정만 하므로, 나중에 구성원에서 빠지거나 비활성이 된 담당자는 false 가 된다.
   */
  @Transactional(readOnly = true)
  public boolean isAssigneeValid(ProjectRow project, Long userId) {
    if (userId == null) return false;
    return validAssignees(project, List.of(userId)).containsKey(userId);
  }

  /**
   * 여러 사용자 중 유효한 담당자(멤버·활성·사람)의 정보 — 한 번에 읽어 쿼리를 아끼려는 일괄판. 자동 지정이 판정과 함께 담당자 정보를 그대로 쓰도록 id → 정보 표로
   * 돌려준다.
   */
  public Map<Long, AssigneeInfo> validAssignees(ProjectRow project, Collection<Long> userIds) {
    if (userIds.isEmpty()) return Map.of();
    List<AssigneeInfo> infos = userRepository.findAssigneeInfos(userIds, TenantContext.get());
    Set<Long> valid = validAssigneeIds(project, infos);
    return infos.stream()
        .filter(u -> valid.contains(u.id()))
        .collect(Collectors.toMap(AssigneeInfo::id, u -> u, (a, b) -> a));
  }

  /** 이미 읽어 온 담당자 정보 중 유효한 담당자(멤버·활성·사람)의 id 집합 — 호출부가 같은 정보를 두 번 읽지 않게 정보를 받는다. */
  private Set<Long> validAssigneeIds(ProjectRow project, List<AssigneeInfo> infos) {
    if (infos.isEmpty()) return Set.of();
    Set<Long> members =
        memberRepository.findMemberUserIds(
            project.id(), infos.stream().map(AssigneeInfo::id).toList());
    return infos.stream()
        .filter(u -> members.contains(u.id()) && u.isActive() && UserKind.HUMAN.equals(u.kind()))
        .map(AssigneeInfo::id)
        .collect(Collectors.toSet());
  }

  /**
   * 쓰기 전 담당자 검증 — 유효하지 않으면 400. 멤버 행을 공유 잠금한 채 확인한다: 동시에 들어온 멤버 제거가 먼저 커밋되면 거절되고, 이쪽이 먼저면 제거가 이 저장의
   * 커밋을 기다린다 (이슈 담당자 지정과 같은 규칙, WP-775).
   */
  private void requireValidAssignee(ProjectRow project, Long userId) {
    memberRepository.lockMemberUserIds(project.id(), List.of(userId));
    if (!isAssigneeValid(project, userId)) {
      throw ComponentException.assigneeInvalid();
    }
  }

  /** 이름이 프로젝트 안에서 비어 있는지(대소문자 무시, 보관된 것 포함) — excludeId 는 자기 자신(이름 변경). */
  private void assertNameFree(long projectId, String name, Long excludeId) {
    boolean taken =
        componentRepository.findByNamesIgnoreCase(projectId, List.of(name)).stream()
            .anyMatch(r -> excludeId == null || r.id() != excludeId);
    if (taken) {
      throw ComponentException.nameTaken(name);
    }
  }

  /**
   * 프로젝트에 속한 구성요소를 찾는다 — 다른 프로젝트의 id 는 없는 것과 같게 404.
   *
   * @param lock true 면 행을 잠그고 읽는다(이름 변경·삭제용)
   */
  private ComponentRow findInProject(ProjectRow project, long componentId, boolean lock) {
    var found =
        lock
            ? componentRepository.lockById(componentId)
            : componentRepository.findById(componentId);
    var row = found.orElseThrow(ComponentException::notFound);
    if (row.projectId() != project.id()) {
      throw ComponentException.notFound();
    }
    return row;
  }

  /**
   * 이슈에 붙이려는 구성요소 행의 검증(WP-933) — 요청 id 가 모두 이 프로젝트에 있어야 하고(400 COMPONENT_NOT_FOUND), 보관된 것은 새로 붙일
   * 수 없다(400 COMPONENT_ARCHIVED). 일반 생성·가져오기·집합 교체가 같은 규칙을 쓰도록 한 곳에 둔다.
   *
   * @param rows 프로젝트 안에서 읽은 행(다른 프로젝트·없는 id 는 빠져 있다)
   * @param requestedCount 요청한 서로 다른 id 의 수
   * @param allowArchived 가져오기처럼 지난 기록이라 보관된 것도 허용하면 true
   */
  public static void requireAttachable(
      List<ComponentRow> rows, int requestedCount, boolean allowArchived) {
    requireInProject(rows, requestedCount);
    if (!allowArchived) requireNotArchived(rows);
  }

  /** 요청한 id 가 모두 프로젝트 안에서 읽혔는지 — 하나라도 빠졌으면 400 COMPONENT_NOT_FOUND. */
  public static void requireInProject(List<ComponentRow> rows, int requestedCount) {
    if (rows.size() != requestedCount) {
      throw ComponentException.notInProject();
    }
  }

  /** 보관된 구성요소가 있으면 400 COMPONENT_ARCHIVED — 목록 순서로 처음 걸린 이름을 알려 준다. */
  public static void requireNotArchived(List<ComponentRow> rows) {
    rows.stream()
        .filter(ComponentRow::archived)
        .findFirst()
        .ifPresent(
            r -> {
              throw ComponentException.archived(r.name());
            });
  }

  /** 행 목록 → 응답. 담당자·유효 여부·이슈 수를 목록 전체에 대해 일괄 조회해 붙인다. */
  private List<ComponentResponse> toResponses(ProjectRow project, List<ComponentRow> rows) {
    if (rows.isEmpty()) return List.of();
    Set<Long> assigneeIds =
        rows.stream()
            .map(ComponentRow::defaultAssigneeId)
            .filter(Objects::nonNull)
            .collect(Collectors.toSet());
    // 담당자 정보는 한 번만 읽어 요약과 유효 판정이 함께 쓴다.
    List<AssigneeInfo> infos = userRepository.findAssigneeInfos(assigneeIds, TenantContext.get());
    Map<Long, UserSummary> assignees = new HashMap<>();
    infos.forEach(u -> assignees.put(u.id(), u.toSummary()));
    Set<Long> valid = validAssigneeIds(project, infos);
    Map<Long, Integer> counts =
        componentRepository.countLiveIssuesByComponents(
            rows.stream().map(ComponentRow::id).toList());
    return rows.stream()
        .map(
            r ->
                new ComponentResponse(
                    r.id(),
                    r.name(),
                    r.description(),
                    r.defaultAssigneeId() == null ? null : assignees.get(r.defaultAssigneeId()),
                    // 담당자가 없으면 경고할 것이 없으므로 true.
                    r.defaultAssigneeId() == null || valid.contains(r.defaultAssigneeId()),
                    r.archived(),
                    counts.getOrDefault(r.id(), 0)))
        .toList();
  }
}
