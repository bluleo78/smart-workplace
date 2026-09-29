package com.workplace.auth.sso;

import static com.workplace.jooq.Tables.MEMBERSHIP;
import static com.workplace.jooq.Tables.TENANT;
import static com.workplace.jooq.Tables.USER;

import java.util.concurrent.atomic.AtomicLong;
import org.jooq.DSLContext;

/** SSO 테스트 시드 헬퍼(WP-48) — 테넌트(SSO on/off)·사용자·멤버십. */
final class SsoTestData {

  private static final AtomicLong SEQ = new AtomicLong(System.nanoTime());

  private SsoTestData() {}

  static long tenant(DSLContext dsl, boolean ssoEnabled) {
    long n = SEQ.incrementAndGet();
    return dsl.insertInto(TENANT)
        .set(TENANT.NAME, "SsoCo" + n)
        .set(TENANT.SLUG, "ssoco-" + n)
        .set(TENANT.STATUS, "ACTIVE")
        .set(TENANT.SSO_ENABLED, ssoEnabled)
        .returning(TENANT.ID)
        .fetchOne()
        .getId();
  }

  /** password 가 null 이면 SSO 전용 계정. */
  static long user(DSLContext dsl, String username, String encodedPassword) {
    return dsl.insertInto(USER)
        .set(USER.USERNAME, username)
        .set(USER.NAME, username)
        .set(USER.PASSWORD, encodedPassword)
        .returning(USER.ID)
        .fetchOne()
        .getId();
  }

  static void member(DSLContext dsl, long userId, long tenantId) {
    dsl.insertInto(MEMBERSHIP)
        .set(MEMBERSHIP.USER_ID, userId)
        .set(MEMBERSHIP.TENANT_ID, tenantId)
        .set(MEMBERSHIP.STATUS, "ACTIVE")
        .execute();
  }

  static String uniqueEmail(String local) {
    return local + "-" + SEQ.incrementAndGet() + "@acme.test";
  }
}
