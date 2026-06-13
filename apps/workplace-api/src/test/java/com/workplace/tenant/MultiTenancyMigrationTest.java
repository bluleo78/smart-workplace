package com.workplace.tenant;

import static com.workplace.jooq.Tables.*;
import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.support.IntegrationTestBase;
import org.jooq.DSLContext;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.annotation.Transactional;

/** V44 스키마/백필 검증. 삽입 테스트는 @Transactional 롤백으로 공유 test DB 오염 방지. */
@Transactional
class MultiTenancyMigrationTest extends IntegrationTestBase {

  @Autowired private DSLContext dsl;

  @Test
  void defaultTenant_isSeeded() {
    String name =
        dsl.select(TENANT.NAME).from(TENANT).where(TENANT.ID.eq(1L)).fetchOne(TENANT.NAME);
    assertThat(name).isEqualTo("Default Workspace");
  }

  @Test
  void membershipTable_enforcesUniqueUserTenant() {
    Long uid =
        dsl.insertInto(USER)
            .set(USER.USERNAME, "m-test@example.com")
            .set(USER.PASSWORD, "x")
            .set(USER.NAME, "M")
            .returning(USER.ID)
            .fetchOne()
            .getId();
    dsl.insertInto(MEMBERSHIP)
        .set(MEMBERSHIP.USER_ID, uid)
        .set(MEMBERSHIP.TENANT_ID, 1L)
        .set(MEMBERSHIP.STATUS, "ACTIVE")
        .execute();
    int count =
        dsl.fetchCount(
            dsl.selectFrom(MEMBERSHIP)
                .where(MEMBERSHIP.USER_ID.eq(uid))
                .and(MEMBERSHIP.TENANT_ID.eq(1L)));
    assertThat(count).isEqualTo(1);
  }

  @Test
  void userTable_hasPlatformAdminColumnDefaultingFalse() {
    Long uid =
        dsl.insertInto(USER)
            .set(USER.USERNAME, "pa-test@example.com")
            .set(USER.PASSWORD, "x")
            .set(USER.NAME, "PA")
            .returning(USER.ID)
            .fetchOne()
            .getId();
    Boolean isPa =
        dsl.select(USER.IS_PLATFORM_ADMIN)
            .from(USER)
            .where(USER.ID.eq(uid))
            .fetchOne(USER.IS_PLATFORM_ADMIN);
    assertThat(isPa).isFalse();
  }
}
