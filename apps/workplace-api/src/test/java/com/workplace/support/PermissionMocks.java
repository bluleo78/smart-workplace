package com.workplace.support;

import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.Mockito.when;

import com.workplace.permission.service.PermissionService;
import java.util.Optional;

/**
 * {@code @WebMvcTest} 보안 하네스용 PermissionService 목 스텁(WP-420).
 *
 * <p>WP-420 부터 JWT 필터는 tenant 클레임이 있으면 {@link PermissionService#getActiveMemberPermissions} 로 멤버십
 * 판정과 권한을 한 번에 얻는다. 하네스의 JwtTokenProvider 목은 {@code getTenantIdFromToken} 을 스텁하지 않아 Mockito 기본값
 * {@code 0L}(Long 래퍼의 기본값은 null 이 아니다)을 돌려주므로, 컨트롤러 테스트는 늘 tenant 경로를 탄다. 그 경로가 각 테스트의 기존 {@code
 * getUserPermissions} 스텁을 그대로 쓰도록 "ACTIVE 멤버 + 그 권한"으로 위임한다. thenAnswer 라 호출 시점에 해석되어, 테스트 메서드 안에서
 * 나중에 바꾼 getUserPermissions 스텁도 반영된다.
 */
public final class PermissionMocks {
  private PermissionMocks() {}

  /**
   * getActiveMemberPermissions(u) → Optional.of(getUserPermissions(u)) — 정지 판정 없이 기존 권한 스텁을 따른다.
   */
  public static void mirrorActiveMember(PermissionService permissionService) {
    when(permissionService.getActiveMemberPermissions(anyLong()))
        .thenAnswer(inv -> Optional.of(permissionService.getUserPermissions(inv.getArgument(0))));
  }
}
