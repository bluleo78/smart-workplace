package com.workplace.global.tenant;

import com.workplace.tenant.repository.TenantRepository;
import java.util.function.Consumer;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * 시스템 잡(스케줄러/부팅 잡)이 RLS 적용 테이블에 접근할 수 있도록, 활성 테넌트마다 {@link TenantContext} 를 설정하고 테넌트별 별도 트랜잭션에서 작업을
 * 실행하는 공통 헬퍼.
 *
 * <p>스케줄러 본체는 요청 스레드가 아니므로 GUC(app.tenant_id)가 비어 있다. RLS 는 미설정 GUC 를 fail-closed(0행)로 처리하므로, 감싸지
 * 않은 정리 잡은 "조용히 아무것도 안 하는" 버그가 된다. 이 헬퍼가 트랜잭션 진입 시점에 {@code
 * TenantAwareTransactionManager}(@Primary)가 GUC 를 주입하도록 테넌트별 트랜잭션을 연다.
 *
 * <p>주의: @Transactional 메서드를 같은 빈 안에서 자기-호출(self-invocation)하면 프록시를 우회해 트랜잭션이 시작되지 않는다. 이 함정을 피하려고
 * 스케줄러 본체는 비-트랜잭션으로 두고, 트랜잭션 경계는 반드시 {@link TransactionTemplate} 로 명시적으로 연다.
 */
@Component
public class TenantScopedRunner {

  private static final Logger log = LoggerFactory.getLogger(TenantScopedRunner.class);

  private final TenantRepository tenantRepository;
  private final TransactionTemplate txTemplate;

  /** {@code TenantAwareTransactionManager}(@Primary) 를 쓰는 TransactionTemplate 으로 테넌트별 트랜잭션을 연다. */
  public TenantScopedRunner(
      TenantRepository tenantRepository, PlatformTransactionManager txManager) {
    this.tenantRepository = tenantRepository;
    this.txTemplate = new TransactionTemplate(txManager);
    // 호출자 트랜잭션 유무와 무관하게 테넌트별로 독립된 트랜잭션을 강제한다(테넌트당 GUC 주입 보장).
    this.txTemplate.setPropagationBehavior(TransactionDefinition.PROPAGATION_REQUIRES_NEW);
  }

  /**
   * 활성 테넌트마다 {@link TenantContext} 를 설정한 뒤 별도 트랜잭션에서 {@code action} 을 실행한다. 트랜잭션 진입 시
   * TenantAwareTransactionManager 가 app.tenant_id GUC 를 주입 → RLS 정책 통과. 한 테넌트의 실패가 나머지를 막지 않도록
   * 격리한다(경고 로그 후 다음 테넌트로 계속).
   *
   * @param action 콜백 — 인자로 현재 테넌트 ID 가 전달된다.
   */
  public void forEachActiveTenant(Consumer<Long> action) {
    for (Long tenantId : tenantRepository.findActiveTenantIds()) {
      TenantContext.set(tenantId);
      try {
        txTemplate.executeWithoutResult(status -> action.accept(tenantId));
      } catch (Exception e) {
        log.warn("테넌트 {} 작업 실패 — 건너뛰고 계속", tenantId, e);
      } finally {
        TenantContext.clear();
      }
    }
  }
}
