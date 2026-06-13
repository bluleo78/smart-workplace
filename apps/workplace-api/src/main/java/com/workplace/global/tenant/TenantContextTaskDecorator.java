package com.workplace.global.tenant;

import org.springframework.core.task.TaskDecorator;

/**
 * 비동기 실행 시 호출 스레드의 active-tenant 를 워커 스레드로 전파한다.
 *
 * <p>ThreadLocal 은 스레드 풀로 자동 전파되지 않으므로, Runnable 제출 시점(요청 스레드)에 TenantContext 값을 캡처한 뒤 워커 스레드 실행 전
 * 복원하고 완료 후 정리한다. 이를 통해 {@code @Async} 핸들러 내 트랜잭션 시작 시 TenantAwareTransactionManager 가
 * GUC(app.tenant_id) 를 올바르게 주입하여 RLS 보호 테이블 조회가 fail-closed 로 차단되지 않는다.
 */
public final class TenantContextTaskDecorator implements TaskDecorator {

  @Override
  public Runnable decorate(Runnable runnable) {
    // 제출(요청) 스레드에서 active-tenant 캡처
    Long tenantId = TenantContext.get();
    return () -> {
      if (tenantId != null) TenantContext.set(tenantId);
      try {
        runnable.run();
      } finally {
        // 풀링된 워커 스레드에 stale tenant 가 남지 않도록 실행 후 항상 정리
        TenantContext.clear();
      }
    };
  }
}
