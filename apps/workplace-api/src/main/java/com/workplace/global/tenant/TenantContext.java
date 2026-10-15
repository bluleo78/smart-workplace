package com.workplace.global.tenant;

import java.util.function.Supplier;

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

  /**
   * tenantId 를 활성 테넌트로 세우고 work 를 실행한 뒤 이전 테넌트로 되돌린다(이전이 없으면 비운다). 실행기·커밋 뒤 작업처럼 풀 스레드에서 테넌트를 다시
   * 세워야 할 때 쓴다 — 끝난 뒤 값이 풀 스레드에 남지 않게. work 의 예외는 그대로 던진다.
   */
  public static <T> T callAs(long tenantId, Supplier<T> work) {
    Long prev = CURRENT.get();
    CURRENT.set(tenantId);
    try {
      return work.get();
    } finally {
      if (prev == null) CURRENT.remove();
      else CURRENT.set(prev);
    }
  }

  /** 결과가 없는 {@link #callAs}. */
  public static void runAs(long tenantId, Runnable work) {
    callAs(
        tenantId,
        () -> {
          work.run();
          return null;
        });
  }
}
