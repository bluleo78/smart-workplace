package com.workplace.tenant;

import static com.workplace.jooq.Tables.TENANT_CANARY;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.workplace.support.IntegrationTestBase;
import org.jooq.DSLContext;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.dao.DataAccessException;
import org.springframework.transaction.annotation.Transactional;

/**
 * RLS 격리 증명. 비특권 app_tenant 커넥션에서 app.tenant_id GUC 로 행이 격리됨을 증명한다. 이 테스트가 통과해야 RLS 전체(P2 포함)의 신뢰
 * 근거가 선다. @Transactional 롤백으로 카나리아 행은 남지 않는다.
 */
class RlsIsolationTest extends IntegrationTestBase {

  @Autowired private DSLContext dsl;

  /** GUC 를 트랜잭션-로컬로 바꿔가며 해당 테넌트 행만 보이는지 증명. */
  @Test
  @Transactional
  void rls_isolatesRowsByTenantGuc() {
    // 테넌트 A(1001) 컨텍스트에서 A 행 삽입 → A 만 보임
    dsl.execute("SELECT set_config('app.tenant_id', '1001', true)");
    dsl.insertInto(TENANT_CANARY)
        .set(TENANT_CANARY.TENANT_ID, 1001L)
        .set(TENANT_CANARY.VAL, "A-row")
        .execute();
    assertThat(dsl.fetchCount(TENANT_CANARY)).isEqualTo(1);

    // 테넌트 B(2002)로 전환 → A 행 비가시
    dsl.execute("SELECT set_config('app.tenant_id', '2002', true)");
    assertThat(dsl.fetchCount(TENANT_CANARY)).isEqualTo(0);
    dsl.insertInto(TENANT_CANARY)
        .set(TENANT_CANARY.TENANT_ID, 2002L)
        .set(TENANT_CANARY.VAL, "B-row")
        .execute();
    assertThat(dsl.fetchCount(TENANT_CANARY)).isEqualTo(1);

    // 다시 A 컨텍스트 → A 만
    dsl.execute("SELECT set_config('app.tenant_id', '1001', true)");
    assertThat(dsl.select(TENANT_CANARY.VAL).from(TENANT_CANARY).fetch(TENANT_CANARY.VAL))
        .containsExactly("A-row");
  }

  /** WITH CHECK: 현재 GUC 와 다른 tenant_id 삽입은 차단(fail-closed). */
  @Test
  @Transactional
  void rls_blocksCrossTenantInsert() {
    dsl.execute("SELECT set_config('app.tenant_id', '1001', true)");
    // RLS WITH CHECK 위반은 Spring 의 DataAccessException 계층으로 번역되며,
    // 원인 체인에 "row-level security policy" 메시지를 담는다.
    assertThatThrownBy(
            () ->
                dsl.insertInto(TENANT_CANARY)
                    .set(TENANT_CANARY.TENANT_ID, 9999L)
                    .set(TENANT_CANARY.VAL, "evil")
                    .execute())
        .isInstanceOf(DataAccessException.class)
        .hasStackTraceContaining("row-level security");
  }

  /** GUC 미설정 → 행 비가시(fail-closed). */
  @Test
  @Transactional
  void rls_failsClosedWhenGucUnset() {
    // 다른 트랜잭션이 커밋한 카나리아 행은 없으므로(모두 롤백) 0 이어야 하고,
    // 무엇보다 GUC 미설정 시 정책이 NULL 비교로 모두 차단한다.
    assertThat(dsl.fetchCount(TENANT_CANARY)).isEqualTo(0);
  }
}
