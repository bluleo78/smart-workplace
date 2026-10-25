package com.workplace.tenant;

import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.support.IntegrationTestBase;
import org.jooq.DSLContext;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

/**
 * 런타임 커넥션(app_tenant)에서 JIT 이 꺼져 있는지 검증(V215). 켜져 있으면 비용 추정이 큰 쿼리(알림 목록 등)가 실행마다 수백 ms 의 LLVM 컴파일을
 * 치른다.
 */
class RuntimeRoleJitTest extends IntegrationTestBase {

  @Autowired private DSLContext dsl;

  @Test
  void runtimeConnection_hasJitOff() {
    assertThat(dsl.fetchValue("SHOW jit")).isEqualTo("off");
  }

  /** 세션 값만 보면 다른 출처(접속 옵션 등)와 구분되지 않는다 — 운영에도 따라가는 롤 설정 자체로 저장됐는지 본다. */
  @Test
  void appTenantRole_storesJitOff() {
    Object setconfig =
        dsl.fetchValue(
            "SELECT array_to_string(s.setconfig, ',') FROM pg_db_role_setting s"
                + " JOIN pg_roles r ON r.oid = s.setrole"
                + " WHERE r.rolname = 'app_tenant' AND s.setdatabase = 0");
    assertThat(setconfig).asString().contains("jit=off");
  }
}
