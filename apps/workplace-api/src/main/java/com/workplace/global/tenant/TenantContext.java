package com.workplace.global.tenant;

/** 요청 스코프 active-tenant 보관. JwtAuthenticationFilter 가 설정, (향후) 트랜잭션 매니저가 GUC 로 주입. */
public final class TenantContext {

  private static final ThreadLocal<Long> CURRENT = new ThreadLocal<>();

  private TenantContext() {}

  public static void set(Long tenantId) {
    CURRENT.set(tenantId);
  }

  /** active-tenant. 없으면 null (tenant-less 토큰/비인증). */
  public static Long get() {
    return CURRENT.get();
  }

  /**
   * active 테넌트를 필수로 읽는다. 전역 테이블(user 등)은 RLS 로 자동 격리되지 않아 호출부가 테넌트를 명시해야 하는데, 컨텍스트가 없는데도 조회를 진행하면
   * 격리가 통째로 빠지므로 fail-fast 한다(#832). 인증된 요청이면 필터가 항상 설정한다.
   */
  public static long require() {
    Long tenantId = CURRENT.get();
    if (tenantId == null) {
      throw new IllegalStateException("active 테넌트 컨텍스트가 필요합니다.");
    }
    return tenantId;
  }

  public static void clear() {
    CURRENT.remove();
  }
}
