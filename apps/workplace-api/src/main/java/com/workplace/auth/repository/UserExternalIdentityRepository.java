package com.workplace.auth.repository;

import static com.workplace.jooq.Tables.USER_EXTERNAL_IDENTITY;

import java.util.Optional;
import lombok.RequiredArgsConstructor;
import org.jooq.DSLContext;
import org.springframework.stereotype.Repository;

/** WP-48: 전역 계정 ↔ 외부 IdP 신원(Entra tid+oid) 연결. 전역 테이블(RLS 비대상). */
@Repository
@RequiredArgsConstructor
public class UserExternalIdentityRepository {

  private final DSLContext dsl;

  public Optional<Long> findUserId(String provider, String tid, String oid) {
    return dsl.select(USER_EXTERNAL_IDENTITY.USER_ID)
        .from(USER_EXTERNAL_IDENTITY)
        .where(USER_EXTERNAL_IDENTITY.PROVIDER.eq(provider))
        .and(USER_EXTERNAL_IDENTITY.ISSUER_TENANT.eq(tid))
        .and(USER_EXTERNAL_IDENTITY.SUBJECT.eq(oid))
        .fetchOptional(USER_EXTERNAL_IDENTITY.USER_ID);
  }

  public boolean existsForUser(long userId, String provider) {
    return dsl.fetchExists(
        dsl.selectFrom(USER_EXTERNAL_IDENTITY)
            .where(USER_EXTERNAL_IDENTITY.USER_ID.eq(userId))
            .and(USER_EXTERNAL_IDENTITY.PROVIDER.eq(provider)));
  }

  /** 연결 저장. 유니크 충돌(동시 최초 로그인 등)이면 false — 호출자가 재조회로 판정한다. */
  public boolean insert(long userId, String provider, String tid, String oid) {
    return dsl.insertInto(USER_EXTERNAL_IDENTITY)
            .set(USER_EXTERNAL_IDENTITY.USER_ID, userId)
            .set(USER_EXTERNAL_IDENTITY.PROVIDER, provider)
            .set(USER_EXTERNAL_IDENTITY.ISSUER_TENANT, tid)
            .set(USER_EXTERNAL_IDENTITY.SUBJECT, oid)
            .onConflictDoNothing()
            .execute()
        > 0;
  }
}
