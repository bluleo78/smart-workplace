package com.workplace.tenant;

import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.support.IntegrationTestBase;
import org.jooq.DSLContext;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

/** 런타임 커넥션이 RLS 적용 대상(비특권 app_tenant)인지 검증. 이게 false 면 RLS 전체가 무력화된다. */
class DataSourceRoleTest extends IntegrationTestBase {

  @Autowired private DSLContext dsl;

  @Test
  void runtimeConnection_usesNonPrivilegedRole() {
    String currentUser = dsl.fetchValue("SELECT current_user").toString();
    assertThat(currentUser).isEqualTo("app_tenant");

    Boolean isSuper =
        (Boolean) dsl.fetchValue("SELECT rolsuper FROM pg_roles WHERE rolname = current_user");
    Boolean bypassRls =
        (Boolean) dsl.fetchValue("SELECT rolbypassrls FROM pg_roles WHERE rolname = current_user");
    assertThat(isSuper).isFalse();
    assertThat(bypassRls).isFalse();
  }
}
