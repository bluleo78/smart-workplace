package com.workplace.role.service;

import com.workplace.global.security.PermissionChecker;
import com.workplace.permission.dto.PermissionResponse;
import com.workplace.permission.repository.PermissionRepository;
import com.workplace.permission.service.PermissionService;
import java.util.Collection;
import java.util.HashSet;
import java.util.Set;
import java.util.stream.Collectors;
import lombok.RequiredArgsConstructor;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.stereotype.Component;

/**
 * 역할·권한 위임 상한(WP-599) — ADMIN 이 아닌 사람은 자기가 가진 권한 안에서만 역할을 주고빼거나 역할의 권한을 바꿀 수 있다.
 *
 * <p>role:assign 만 받은 구성원이 자기에게 ADMIN 을 주거나, role:write 만 받은 구성원이 자기 역할에 권한 전체를 넣어 관리자가 되던 권한 상승을
 * 막는다. 「바뀌는 것」(새로 주거나 빼는 역할, 넣거나 빼는 권한)만 본다 — 자기보다 강한 역할을 남에게서 빼는(강등) 것도 같은 기준으로 막고, 바뀌지 않는 나머지는
 * 그대로 둔다. ADMIN 역할 보유자는 제한하지 않는다.
 */
@Component
@RequiredArgsConstructor
public class RoleGrantGuard {

  private final PermissionChecker permissionChecker;
  private final PermissionService permissionService;
  private final PermissionRepository permissionRepository;

  /** 사용자의 역할을 currentRoleIds → newRoleIds 로 바꿀 자격 — 주거나 빼는 역할의 권한이 모두 호출자 권한 안이어야 한다. */
  public void requireCanChangeRoles(
      Long callerId, Collection<Long> currentRoleIds, Collection<Long> newRoleIds) {
    Set<Long> changed = symmetricDifference(currentRoleIds, newRoleIds);
    if (changed.isEmpty() || isAdmin(callerId)) return;
    Set<String> mine = permissionService.getUserPermissions(callerId);
    for (Long roleId : changed) {
      if (!mine.containsAll(codesOf(roleId))) {
        throw new AccessDeniedException("자신에게 없는 권한이 담긴 역할은 주거나 뺄 수 없습니다");
      }
    }
  }

  /** 역할 권한을 currentCodes → newCodes 로 바꿀 자격 — 넣거나 빼는 권한이 모두 호출자 권한 안이어야 한다. */
  public void requireCanChangePermissions(
      Long callerId, Collection<String> currentCodes, Collection<String> newCodes) {
    Set<String> changed = symmetricDifference(currentCodes, newCodes);
    if (changed.isEmpty() || isAdmin(callerId)) return;
    if (!permissionService.getUserPermissions(callerId).containsAll(changed)) {
      throw new AccessDeniedException("자신에게 없는 권한은 역할에 넣거나 뺄 수 없습니다");
    }
  }

  private boolean isAdmin(Long callerId) {
    return permissionChecker.userHasRole(callerId, "ADMIN");
  }

  private Set<String> codesOf(Long roleId) {
    return permissionRepository.findByRoleId(roleId).stream()
        .map(PermissionResponse::code)
        .collect(Collectors.toSet());
  }

  private static <T> Set<T> symmetricDifference(Collection<T> a, Collection<T> b) {
    Set<T> out = new HashSet<>(a);
    out.addAll(b);
    Set<T> both = new HashSet<>(a);
    both.retainAll(b);
    out.removeAll(both);
    return out;
  }
}
