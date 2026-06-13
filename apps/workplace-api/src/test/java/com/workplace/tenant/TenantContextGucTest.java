package com.workplace.tenant;

import static com.workplace.jooq.Tables.TENANT_CANARY;
import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.global.tenant.TenantAwareTransactionManager;
import com.workplace.global.tenant.TenantContext;
import com.workplace.support.IntegrationTestBase;
import org.jooq.DSLContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * TenantContext → 트랜잭션-로컬 GUC 주입이 실제 트랜잭션에서 동작함을 검증. @Transactional 테스트는 본문 전에 트랜잭션이 시작돼
 * TenantContext 설정이 늦으므로, 운영과 동일하게 "컨텍스트 설정 후 트랜잭션 시작" 순서를 보장하는 TransactionTemplate 으로 검증한다.
 */
class TenantContextGucTest extends IntegrationTestBase {

  @Autowired private DSLContext dsl;
  @Autowired private PlatformTransactionManager txManager;

  @AfterEach
  void tearDown() {
    TenantContext.clear();
  }

  @Test
  void primaryTransactionManager_isTenantAware() {
    assertThat(txManager).isInstanceOf(TenantAwareTransactionManager.class);
  }

  /** TenantContext 가 트랜잭션-로컬 GUC 로 반영되어 도메인 코드가 GUC 를 만지지 않아도 격리된다. */
  @Test
  void tenantContext_setsGucForRls() {
    TenantContext.set(1001L);
    new TransactionTemplate(txManager)
        .execute(
            status -> {
              String guc = (String) dsl.fetchValue("SELECT current_setting('app.tenant_id', true)");
              assertThat(guc).isEqualTo("1001");

              dsl.insertInto(TENANT_CANARY)
                  .set(TENANT_CANARY.TENANT_ID, 1001L)
                  .set(TENANT_CANARY.VAL, "ctx-A")
                  .execute();
              assertThat(dsl.fetchCount(TENANT_CANARY)).isEqualTo(1);

              status.setRollbackOnly(); // 카나리아 행 오염 방지
              return null;
            });
  }

  /** LOCAL 미설정(TenantContext 없음) → 세션 GUC 기본값(tenant#1)이 적용됨을 직접 검증. connection-init-sql 회귀 가드. */
  @Test
  void noTenantContext_usesSessionDefaultTenant1() {
    new TransactionTemplate(txManager)
        .execute(
            status -> {
              String guc = (String) dsl.fetchValue("SELECT current_setting('app.tenant_id', true)");
              assertThat(guc).isEqualTo("1");
              // 세션 기본 테넌트(1)로 RLS WITH CHECK 통과 + 가시
              dsl.insertInto(TENANT_CANARY)
                  .set(TENANT_CANARY.TENANT_ID, 1L)
                  .set(TENANT_CANARY.VAL, "sess-default")
                  .execute();
              assertThat(
                      dsl.fetchCount(
                          dsl.selectFrom(TENANT_CANARY)
                              .where(TENANT_CANARY.VAL.eq("sess-default"))))
                  .isEqualTo(1);
              status.setRollbackOnly();
              return null;
            });
  }
}
