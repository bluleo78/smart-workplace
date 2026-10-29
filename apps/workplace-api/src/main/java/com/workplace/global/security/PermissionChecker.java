package com.workplace.global.security;

import com.workplace.permission.service.PermissionService;
import com.workplace.role.repository.RoleRepository;
import java.util.Collection;
import java.util.Set;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** 사용자 권한(permission) 및 역할(role) 보유 여부를 확인하는 서비스. */
@Service
@RequiredArgsConstructor
public class PermissionChecker {

  private final PermissionService permissionService;
  private final RoleRepository roleRepository;

  /** 사용자가 특정 권한 코드를 보유하는지 여부(멤버 기본 권한 포함 — 인증 필터와 같은 판정). */
  public boolean hasPermission(Long userId, String permissionCode) {
    return permissionService.getUserPermissions(userId).contains(permissionCode);
  }

  /**
   * 사용자가 특정 역할명을 보유하는지 여부. ADMIN 우회 처리 등에 사용.
   *
   * @param userId 사용자 ID
   * @param roleName 역할명 (예: "ADMIN")
   * @return 해당 역할 보유 시 true
   */
  // WP-729: user_role 은 테넌트 RLS — 요청 트랜잭션 밖(PermissionInterceptor)에서 불려도 테넌트 GUC 가 들어가도록 자기 트랜잭션을
  // 연다.
  @Transactional(readOnly = true)
  public boolean userHasRole(Long userId, String roleName) {
    return roleRepository.findByUserId(userId).stream().anyMatch(r -> r.name().equals(roleName));
  }

  /** {@link #userHasRole} 를 여러 사람에게 한 번에 — 그 역할을 가진 사람 id(WP-1129). */
  @Transactional(readOnly = true)
  public Set<Long> usersWithRole(Collection<Long> userIds, String roleName) {
    return roleRepository.findUserIdsWithRole(userIds, roleName);
  }
}
