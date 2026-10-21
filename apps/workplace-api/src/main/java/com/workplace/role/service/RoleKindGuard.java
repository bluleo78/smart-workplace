package com.workplace.role.service;

import com.workplace.permission.dto.PermissionResponse;
import com.workplace.permission.repository.PermissionRepository;
import com.workplace.role.dto.AdminPermissionCodes;
import com.workplace.role.dto.RoleResponse;
import com.workplace.role.repository.RoleRepository;
import com.workplace.user.dto.UserKind;
import java.util.Collection;
import java.util.HashSet;
import java.util.Set;
import java.util.stream.Collectors;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;

/**
 * 대상 종류(사람·AI)에 맞는 역할만 주게 하는 가드(WP-728, 결정 A).
 *
 * <p>AI 에이전트에게 ADMIN 이나 관리 권한이 든 역할을 주면 그 AI 의 키로 관리자 계정 생성·역할 변경까지 할 수 있어, 프롬프트 주입·오동작 한 번에 워크스페이스
 * 관리 권한이 노출된다. 사람에게 AGENT 시스템 역할을 주면 종류와 역할이 어긋난다. 둘 다 「새로 주는 것」만 막는다 — 이미 가진 역할은 자동으로 빼지 않는다(운영 중인
 * AI 가 갑자기 권한을 잃지 않게, 필요하면 관리자가 직접 뺀다).
 */
@Component
@RequiredArgsConstructor
public class RoleKindGuard {

  private static final String ADMIN_ROLE = "ADMIN";
  private static final String AGENT_ROLE = "AGENT";

  private final RoleRepository roleRepository;
  private final PermissionRepository permissionRepository;

  /** 대상(kind)의 역할을 currentRoleIds → newRoleIds 로 바꿀 때, 새로 더해지는 역할이 대상 종류에 맞는지 본다. 어긋나면 400. */
  public void requireAssignable(
      String targetKind, Collection<Long> currentRoleIds, Collection<Long> newRoleIds) {
    Set<Long> added = new HashSet<>(newRoleIds);
    added.removeAll(currentRoleIds);
    boolean agent = UserKind.isAgent(targetKind);
    for (Long roleId : added) {
      RoleResponse role = roleRepository.findById(roleId).orElse(null);
      if (role == null) continue; // 없는 역할은 호출부가 이미 거절한다.
      if (agent && grantsAdmin(role)) {
        throw new IllegalArgumentException(
            "AI 에이전트에게는 관리자 역할이나 관리 권한이 든 역할을 줄 수 없습니다: " + role.name());
      }
      if (!agent && role.isSystem() && AGENT_ROLE.equals(role.name())) {
        throw new IllegalArgumentException("사람 구성원에게는 AGENT 역할을 줄 수 없습니다");
      }
    }
  }

  /** AI 가 가진 역할에 관리 권한을 새로 더하는지 — 더하면 역할 할당을 거치지 않고 AI 가 관리 권한을 얻게 되므로 400. */
  public void requireNoAdminPermissionForAgentRole(
      Long roleId, Collection<String> currentCodes, Collection<String> newCodes) {
    Set<String> addedAdmin = new HashSet<>(newCodes);
    addedAdmin.removeAll(currentCodes);
    addedAdmin.retainAll(AdminPermissionCodes.CODES);
    if (addedAdmin.isEmpty() || roleRepository.countAgentHolders(roleId) == 0) return;
    throw new IllegalArgumentException(
        "AI 에이전트가 가진 역할에는 관리 권한을 더할 수 없습니다: "
            + addedAdmin.stream().sorted().collect(Collectors.joining(", ")));
  }

  /** ADMIN 시스템 역할이거나 관리 권한이 하나라도 든 역할인지. */
  public boolean grantsAdmin(RoleResponse role) {
    if (role.isSystem() && ADMIN_ROLE.equals(role.name())) return true;
    return permissionRepository.findByRoleId(role.id()).stream()
        .map(PermissionResponse::code)
        .anyMatch(AdminPermissionCodes.CODES::contains);
  }
}
