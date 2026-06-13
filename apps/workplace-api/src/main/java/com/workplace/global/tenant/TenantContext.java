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

  public static void clear() {
    CURRENT.remove();
  }
}
