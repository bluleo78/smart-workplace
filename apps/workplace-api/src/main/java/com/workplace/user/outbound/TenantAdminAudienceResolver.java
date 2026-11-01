package com.workplace.user.outbound;

import com.workplace.global.realtime.AudienceResolver;
import com.workplace.user.repository.UserRepository;
import java.util.Collection;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;

/**
 * TENANT_ADMIN scope 수신자 = 워크스페이스의 활성 ADMIN 전원(WP-1254). 관리자만 여는 화면(AI 실행 상태·실행 위치 등
 * {@code @RequireAdmin} API 를 쓰는 화면)의 변경을 그 화면을 볼 수 있는 사람에게만 보낸다 — 테넌트 전원(TENANT)에게 보내면 관리자가 아닌
 * 사람에게 관리 정보의 변경 신호가 샌다. scopeId 는 tenantId 다. 판정은 {@code @RequireAdmin} 과 같은 ADMIN 역할에 이 워크스페이스 활성
 * 멤버십을 더한 것이다.
 */
@Component
@RequiredArgsConstructor
public class TenantAdminAudienceResolver implements AudienceResolver {

  public static final String SCOPE = "TENANT_ADMIN";

  private final UserRepository userRepository;

  @Override
  public String scopeType() {
    return SCOPE;
  }

  @Override
  public Collection<Long> resolve(long tenantId) {
    return userRepository.findWorkspaceActiveAdminIds(tenantId);
  }
}
