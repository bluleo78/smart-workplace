package com.workplace.global.security;

import com.workplace.permission.repository.PermissionRepository;
import com.workplace.role.repository.RoleRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;

/** 사용자 권한(permission) 및 역할(role) 보유 여부를 확인하는 서비스. */
@Service
@RequiredArgsConstructor
public class PermissionChecker {

  private final PermissionRepository permissionRepository;
  private final RoleRepository roleRepository;

  /** 사용자가 특정 권한 코드를 보유하는지 여부. */
  public boolean hasPermission(Long userId, String permissionCode) {
    return permissionRepository.findPermissionCodesByUserId(userId).contains(permissionCode);
  }

  /**
   * 사용자가 특정 역할명을 보유하는지 여부. ADMIN 우회 처리 등에 사용.
   *
   * @param userId 사용자 ID
   * @param roleName 역할명 (예: "ADMIN")
   * @return 해당 역할 보유 시 true
   */
  public boolean userHasRole(Long userId, String roleName) {
    return roleRepository.findByUserId(userId).stream().anyMatch(r -> r.name().equals(roleName));
  }
}
