package com.workplace.auth.sso;

import static com.workplace.jooq.Tables.PERMISSION;
import static com.workplace.jooq.Tables.ROLE;
import static com.workplace.jooq.Tables.ROLE_PERMISSION;
import static com.workplace.jooq.Tables.TENANT;
import static com.workplace.jooq.Tables.USER_EXTERNAL_IDENTITY;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.workplace.support.IntegrationTestBase;
import com.workplace.support.TestFixtures;
import org.jooq.DSLContext;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.transaction.annotation.Transactional;

/** WP-48 SSO 스키마 — tenant.sso_enabled 기본값, 연결 테이블 유니크 제약, sso:manage 권한 시드. */
@Transactional
class SsoSchemaTest extends IntegrationTestBase {

  @Autowired DSLContext dsl;
  @Autowired SsoProperties props;

  @Test
  void tenantSsoEnabled_defaultsToFalse() {
    Long id =
        dsl.insertInto(TENANT)
            .set(TENANT.NAME, "Schema")
            .set(TENANT.SLUG, "schema-" + System.nanoTime())
            .set(TENANT.STATUS, "ACTIVE")
            .returning(TENANT.ID)
            .fetchOne()
            .getId();
    assertThat(dsl.select(TENANT.SSO_ENABLED).from(TENANT).where(TENANT.ID.eq(id)).fetchOne(TENANT.SSO_ENABLED))
        .isFalse();
  }

  @Test
  void externalIdentity_isUniquePerSubjectAndPerUserProvider() {
    long u1 = TestFixtures.createHuman(dsl);
    long u2 = TestFixtures.createHuman(dsl);
    insertIdentity(u1, "tid-1", "oid-1");
    // 같은 (provider, tid, oid) 를 다른 사용자에게 — 거부
    assertThatThrownBy(() -> insertIdentity(u2, "tid-1", "oid-1"))
        .isInstanceOf(DataIntegrityViolationException.class);
  }

  @Test
  void externalIdentity_oneM365LinkPerUser() {
    long u1 = TestFixtures.createHuman(dsl);
    insertIdentity(u1, "tid-1", "oid-a");
    assertThatThrownBy(() -> insertIdentity(u1, "tid-1", "oid-b"))
        .isInstanceOf(DataIntegrityViolationException.class);
  }

  @Test
  void ssoManage_grantedToSystemAdminRole() {
    boolean granted =
        dsl.fetchExists(
            dsl.select()
                .from(ROLE_PERMISSION)
                .join(ROLE).on(ROLE.ID.eq(ROLE_PERMISSION.ROLE_ID))
                .join(PERMISSION).on(PERMISSION.ID.eq(ROLE_PERMISSION.PERMISSION_ID))
                .where(ROLE.NAME.eq("ADMIN"))
                .and(PERMISSION.CODE.eq("sso:manage")));
    assertThat(granted).isTrue();
  }

  @Test
  void testProfile_hasSsoAvailable() {
    assertThat(props.isAvailable()).isTrue();
    assertThat(props.authority()).doesNotEndWith("/");
  }

  private void insertIdentity(long userId, String tid, String oid) {
    dsl.insertInto(USER_EXTERNAL_IDENTITY)
        .set(USER_EXTERNAL_IDENTITY.USER_ID, userId)
        .set(USER_EXTERNAL_IDENTITY.PROVIDER, "M365")
        .set(USER_EXTERNAL_IDENTITY.ISSUER_TENANT, tid)
        .set(USER_EXTERNAL_IDENTITY.SUBJECT, oid)
        .execute();
  }
}
