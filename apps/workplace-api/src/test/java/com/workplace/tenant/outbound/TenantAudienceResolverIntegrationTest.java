package com.workplace.tenant.outbound;

import static com.workplace.jooq.Tables.MEMBERSHIP;
import static com.workplace.jooq.Tables.TENANT;
import static com.workplace.jooq.Tables.USER;
import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.support.IntegrationTestBase;
import org.jooq.DSLContext;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.annotation.Transactional;

/** TENANT scope 리졸버 — ACTIVE 멤버만 수신자에 포함되고 SUSPENDED·타 테넌트는 제외되는지 검증(롤백). */
@Transactional
class TenantAudienceResolverIntegrationTest extends IntegrationTestBase {

  @Autowired private TenantAudienceResolver resolver;
  @Autowired private DSLContext dsl;

  private long user(String name) {
    return dsl.insertInto(USER)
        .set(USER.USERNAME, name + "@example.com")
        .set(USER.PASSWORD, "x")
        .set(USER.NAME, name)
        .returning(USER.ID)
        .fetchOne()
        .getId();
  }

  private long tenant(String slug) {
    return dsl.insertInto(TENANT)
        .set(TENANT.NAME, slug)
        .set(TENANT.SLUG, slug)
        .set(TENANT.STATUS, "ACTIVE")
        .returning(TENANT.ID)
        .fetchOne()
        .getId();
  }

  private void member(long userId, long tenantId, String status) {
    dsl.insertInto(MEMBERSHIP)
        .set(MEMBERSHIP.USER_ID, userId)
        .set(MEMBERSHIP.TENANT_ID, tenantId)
        .set(MEMBERSHIP.STATUS, status)
        .execute();
  }

  @Test
  void resolvesOnlyActiveMembersOfTenant() {
    long t = tenant("aud-t1-" + System.nanoTime());
    long other = tenant("aud-t2-" + System.nanoTime());
    long a = user("aud-a-" + System.nanoTime());
    long b = user("aud-b-" + System.nanoTime());
    long suspended = user("aud-s-" + System.nanoTime());
    long otherTenantUser = user("aud-o-" + System.nanoTime());
    member(a, t, "ACTIVE");
    member(b, t, "ACTIVE");
    member(suspended, t, "SUSPENDED");
    member(otherTenantUser, other, "ACTIVE");

    assertThat(resolver.scopeType()).isEqualTo("TENANT");
    assertThat(resolver.resolve(t))
        .containsExactlyInAnyOrder(a, b)
        .doesNotContain(suspended, otherTenantUser);
  }
}
