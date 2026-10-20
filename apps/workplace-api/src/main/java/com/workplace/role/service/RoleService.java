package com.workplace.role.service;

import com.workplace.audit.service.AuditLogService;
import com.workplace.permission.dto.PermissionResponse;
import com.workplace.permission.repository.PermissionRepository;
import com.workplace.role.dto.RoleDetailResponse;
import com.workplace.role.dto.RoleResponse;
import com.workplace.role.exception.RoleAssignedException;
import com.workplace.role.exception.RoleNotFoundException;
import com.workplace.role.exception.SystemRoleModificationException;
import com.workplace.role.repository.RoleRepository;
import com.workplace.user.dto.UserResponse;
import com.workplace.user.repository.UserRepository;
import java.util.List;
import java.util.Map;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
@RequiredArgsConstructor
public class RoleService {

  private final RoleRepository roleRepository;
  private final PermissionRepository permissionRepository;
  // WP-567: 역할 생성·수정·삭제·권한 변경을 행위자와 함께 감사 로그에 남긴다.
  private final AuditLogService auditLogService;
  private final UserRepository userRepository;

  @Transactional(readOnly = true)
  public List<RoleResponse> getAllRoles() {
    return roleRepository.findAll();
  }

  @Transactional(readOnly = true)
  public RoleDetailResponse getRoleById(Long id) {
    RoleResponse role =
        roleRepository
            .findById(id)
            .orElseThrow(() -> new RoleNotFoundException("역할을 찾을 수 없습니다 (id: " + id + ")"));
    List<PermissionResponse> permissions = permissionRepository.findByRoleId(id);
    return new RoleDetailResponse(
        role.id(), role.name(), role.description(), role.isSystem(), permissions);
  }

  @Transactional
  public RoleResponse createRole(String name, String description, Long callerId) {
    if (roleRepository.existsByName(name)) {
      throw new IllegalArgumentException("이미 존재하는 역할 이름입니다: " + name);
    }
    RoleResponse created = roleRepository.save(name, description);
    audit(callerId, "ROLE_CREATED", created.id(), "역할 생성: " + name, null);
    return created;
  }

  @Transactional
  public void updateRole(Long id, String name, String description, Long callerId) {
    RoleResponse role =
        roleRepository
            .findById(id)
            .orElseThrow(() -> new RoleNotFoundException("역할을 찾을 수 없습니다 (id: " + id + ")"));

    if (role.isSystem() && !role.name().equals(name)) {
      throw new SystemRoleModificationException(
          "시스템 역할의 이름은 바꿀 수 없습니다 (name: " + role.name() + ")");
    }

    // #795: createRole() 과 동일하게, 이름이 실제로 바뀌는 경우에만 중복 여부를 사전 검사한다.
    // 이 검사가 없으면 DB unique 제약 위반이 DataIntegrityViolationException 으로 전파되어
    // GlobalExceptionHandler 가 영문 기술 메시지를 그대로 사용자에게 노출하게 된다.
    if (!role.name().equals(name) && roleRepository.existsByName(name)) {
      throw new IllegalArgumentException("이미 존재하는 역할 이름입니다: " + name);
    }

    roleRepository.update(id, name, description);
    audit(
        callerId,
        "ROLE_UPDATED",
        id,
        role.name().equals(name) ? "역할 수정: " + name : "역할 수정: " + role.name() + " → " + name,
        Map.of("beforeName", role.name(), "afterName", name));
  }

  @Transactional
  public void deleteRole(Long id, Long callerId) {
    RoleResponse role =
        roleRepository
            .findById(id)
            .orElseThrow(() -> new RoleNotFoundException("역할을 찾을 수 없습니다 (id: " + id + ")"));

    if (role.isSystem()) {
      throw new SystemRoleModificationException("시스템 역할은 삭제할 수 없습니다 (name: " + role.name() + ")");
    }

    // user_role FK 가 ON DELETE CASCADE 이므로, 삭제 전 할당된 사용자가 있으면 명시적으로 차단해
    // 권한이 통지 없이 조용히 사라지는 것을 방지한다 (#678). 강제 삭제가 필요하면 먼저
    // 사용자쪽에서 역할 할당을 해제해야 한다.
    int assignedUserCount = roleRepository.countAssignedUsers(id);
    if (assignedUserCount > 0) {
      throw new RoleAssignedException(
          "%d명의 사용자에게 할당된 역할은 삭제할 수 없습니다: %s".formatted(assignedUserCount, role.name()));
    }

    roleRepository.deleteById(id);
    audit(callerId, "ROLE_DELETED", id, "역할 삭제: " + role.name(), null);
  }

  @Transactional
  public void setRolePermissions(Long roleId, List<Long> permissionIds, Long callerId) {
    RoleResponse role =
        roleRepository
            .findById(roleId)
            .orElseThrow(() -> new RoleNotFoundException("역할을 찾을 수 없습니다 (id: " + roleId + ")"));

    if (role.isSystem()) {
      throw new SystemRoleModificationException(
          "시스템 역할의 권한은 변경할 수 없습니다 (name: " + role.name() + ")");
    }

    List<String> before = permissionCodesOf(roleId);
    roleRepository.setPermissions(roleId, permissionIds);
    List<String> after = permissionCodesOf(roleId);
    audit(
        callerId,
        "ROLE_PERMISSIONS_CHANGED",
        roleId,
        "역할 권한 변경: " + role.name() + " (" + before.size() + "개 → " + after.size() + "개)",
        Map.of("before", String.join(",", before), "after", String.join(",", after)));
  }

  /** 역할이 가진 권한 코드(정렬) — 권한 변경 전후 기록용. */
  private List<String> permissionCodesOf(Long roleId) {
    return permissionRepository.findByRoleId(roleId).stream()
        .map(PermissionResponse::code)
        .sorted()
        .toList();
  }

  /**
   * 역할 관리 행위의 성공 감사 로그(WP-567) — resource=role, resource_id=역할 id. 행위자가 없으면(테스트·내부 호출) username 은
   * "system".
   */
  private void audit(
      Long callerId,
      String actionType,
      Long roleId,
      String description,
      Map<String, String> metadata) {
    String username =
        callerId == null
            ? "system"
            : userRepository.findById(callerId).map(UserResponse::username).orElse("system");
    auditLogService.log(
        callerId,
        username,
        actionType,
        "role",
        String.valueOf(roleId),
        description,
        null,
        null,
        "SUCCESS",
        null,
        metadata);
  }
}
