package com.workplace.role.service;

import com.workplace.permission.dto.PermissionResponse;
import com.workplace.permission.repository.PermissionRepository;
import com.workplace.role.dto.RoleDetailResponse;
import com.workplace.role.dto.RoleResponse;
import com.workplace.role.exception.RoleAssignedException;
import com.workplace.role.exception.RoleNotFoundException;
import com.workplace.role.exception.SystemRoleModificationException;
import com.workplace.role.repository.RoleRepository;
import java.util.List;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
@RequiredArgsConstructor
public class RoleService {

  private final RoleRepository roleRepository;
  private final PermissionRepository permissionRepository;

  @Transactional(readOnly = true)
  public List<RoleResponse> getAllRoles() {
    return roleRepository.findAll();
  }

  @Transactional(readOnly = true)
  public RoleDetailResponse getRoleById(Long id) {
    RoleResponse role =
        roleRepository
            .findById(id)
            .orElseThrow(() -> new RoleNotFoundException("Role not found: " + id));
    List<PermissionResponse> permissions = permissionRepository.findByRoleId(id);
    return new RoleDetailResponse(
        role.id(), role.name(), role.description(), role.isSystem(), permissions);
  }

  @Transactional
  public RoleResponse createRole(String name, String description) {
    if (roleRepository.existsByName(name)) {
      throw new IllegalArgumentException("이미 존재하는 역할 이름입니다: " + name);
    }
    return roleRepository.save(name, description);
  }

  @Transactional
  public void updateRole(Long id, String name, String description) {
    RoleResponse role =
        roleRepository
            .findById(id)
            .orElseThrow(() -> new RoleNotFoundException("Role not found: " + id));

    if (role.isSystem() && !role.name().equals(name)) {
      throw new SystemRoleModificationException(
          "Cannot change name of system role: " + role.name());
    }

    roleRepository.update(id, name, description);
  }

  @Transactional
  public void deleteRole(Long id) {
    RoleResponse role =
        roleRepository
            .findById(id)
            .orElseThrow(() -> new RoleNotFoundException("Role not found: " + id));

    if (role.isSystem()) {
      throw new SystemRoleModificationException("Cannot delete system role: " + role.name());
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
  }

  @Transactional
  public void setRolePermissions(Long roleId, List<Long> permissionIds) {
    RoleResponse role =
        roleRepository
            .findById(roleId)
            .orElseThrow(() -> new RoleNotFoundException("Role not found: " + roleId));

    if (role.isSystem()) {
      throw new SystemRoleModificationException(
          "Cannot modify permissions of system role: " + role.name());
    }

    roleRepository.setPermissions(roleId, permissionIds);
  }
}
