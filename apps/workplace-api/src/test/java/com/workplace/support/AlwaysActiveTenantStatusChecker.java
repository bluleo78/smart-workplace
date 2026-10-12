package com.workplace.support;

import com.workplace.global.tenant.TenantStatusChecker;

/**
 * WebMvc 슬라이스 테스트용 테넌트 상태 확인 대역 — 항상 ACTIVE(WP-341).
 *
 * <p>슬라이스 테스트는 JwtTokenProvider 를 Mockito 로 대체하는데, 래퍼 타입 기본 응답 때문에 {@code getTenantIdFromToken} 이
 * {@code 0L} 을 돌려준다. 그대로 Mockito 대역(기본 false)을 쓰면 JwtAuthenticationFilter 가 모든 요청을 401 로 만든다. 슬라이스
 * 테스트의 관심사는 컨트롤러 계약이므로 테넌트는 항상 활성으로 본다(실제 차단은 InactiveTenantAccessTest 가 검증).
 */
public class AlwaysActiveTenantStatusChecker extends TenantStatusChecker {

  public AlwaysActiveTenantStatusChecker() {
    super(null, 0);
  }

  /** 항상 활성. */
  @Override
  public boolean isActive(long tenantId) {
    return true;
  }
}
