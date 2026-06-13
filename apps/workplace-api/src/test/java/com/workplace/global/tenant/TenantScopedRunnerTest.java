package com.workplace.global.tenant;

import static com.workplace.jooq.Tables.TENANT;
import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.support.IntegrationTestBase;
import java.util.ArrayList;
import java.util.List;
import org.jooq.DSLContext;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

/**
 * TenantScopedRunner 통합 테스트 — 활성 테넌트마다 GUC(app.tenant_id)가 콜백 시점에 해당 테넌트로 박혀 있는지, 그리고 한 테넌트 콜백 실패가
 * 다른 테넌트 콜백을 막지 않는지(격리) 검증한다.
 *
 * <p>Runner 는 REQUIRES_NEW 트랜잭션을 별도 커넥션으로 열고 findActiveTenantIds 로 '커밋된' 테넌트를 순회하므로, 테스트용 두 번째 테넌트를
 * 미리 커밋해 둔다(app_tenant 는 tenant DELETE 권한이 없어 V46 — 고정 슬러그 find-or-create 로 누적 방지, 잔존 행은 다른 통합 테스트가
 * USER 등을 남기는 것과 동일한 공유-DB 철학상 무해).
 */
class TenantScopedRunnerTest extends IntegrationTestBase {

  @Autowired private TenantScopedRunner runner;
  @Autowired private DSLContext dsl;

  private static final String TEST_TENANT_SLUG = "runner-test-tenant-2";

  /** 고정 슬러그로 두 번째 ACTIVE 테넌트를 find-or-create(커밋 상태)하고 id 반환. */
  private long ensureSecondTenant() {
    Long existing =
        dsl.select(TENANT.ID)
            .from(TENANT)
            .where(TENANT.SLUG.eq(TEST_TENANT_SLUG))
            .fetchOne(TENANT.ID);
    if (existing != null) {
      return existing;
    }
    return dsl.insertInto(TENANT)
        .set(TENANT.SLUG, TEST_TENANT_SLUG)
        .set(TENANT.NAME, "Runner Test Tenant 2")
        .set(TENANT.STATUS, "ACTIVE")
        .returning(TENANT.ID)
        .fetchOne()
        .getId();
  }

  @Test
  void forEachActiveTenant_injectsGucPerTenant() {
    long tid2 = ensureSecondTenant();

    // 콜백마다 현재 트랜잭션-로컬 GUC 값을 조회해 (전달된 tenantId, GUC) 쌍을 수집한다.
    List<Long[]> observed = new ArrayList<>();
    runner.forEachActiveTenant(
        tid -> {
          Long guc =
              dsl.fetchOne("SELECT current_setting('app.tenant_id', true)::bigint AS v")
                  .get("v", Long.class);
          observed.add(new Long[] {tid, guc});
        });

    // 모든 콜백에서 GUC == 전달된 tenantId 여야 한다.
    assertThat(observed).isNotEmpty();
    for (Long[] pair : observed) {
      assertThat(pair[1]).as("GUC == 콜백 tenantId").isEqualTo(pair[0]);
    }
    // 최소한 tenant#1 과 두 번째 테넌트가 순회 대상에 포함되어야 한다.
    List<Long> visited = observed.stream().map(p -> p[0]).toList();
    assertThat(visited).contains(1L, tid2);
  }

  @Test
  void forEachActiveTenant_isolatesPerTenantFailure() {
    ensureSecondTenant();

    // 첫 콜백에서 예외를 던져도 나머지 테넌트 콜백이 호출되어야 한다(격리).
    List<Long> visited = new ArrayList<>();
    runner.forEachActiveTenant(
        tid -> {
          visited.add(tid);
          throw new RuntimeException("의도적 실패(tenant=" + tid + ")");
        });

    // 모든 활성 테넌트가 호출됨 — 한 테넌트 실패가 순회를 중단시키지 않음.
    long activeCount = dsl.fetchCount(dsl.selectFrom(TENANT).where(TENANT.STATUS.eq("ACTIVE")));
    assertThat(visited).hasSize((int) activeCount);
  }
}
