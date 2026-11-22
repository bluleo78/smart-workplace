package com.workplace.mail.repository;

import static com.workplace.jooq.Tables.MAIL_OAUTH_STATE;

import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.Optional;
import lombok.RequiredArgsConstructor;
import org.jooq.DSLContext;
import org.springframework.stereotype.Repository;

/**
 * M365 메일 연결 OAuth state 저장소(WP-1976) — mail_oauth_state.
 *
 * <p>start 와 complete 가 서로 다른 파드로 가도 state 를 찾도록 DB 에 둔다. state 원문 대신 SHA-256 해시만 저장한다. RLS 를 쓰므로
 * 호출자의 트랜잭션(GUC) 안에서 불러야 하며, 다른 테넌트의 행은 보이지 않는다.
 */
@Repository
@RequiredArgsConstructor
public class MailOAuthStateRepository {

  private final DSLContext dsl;

  /** 소비된 state 의 결속 값. */
  public record Row(long userId, long tenantId, Instant expiresAt) {}

  /** state 해시를 저장한다. tenant_id 는 컬럼 기본값(GUC)으로 채워진다. */
  public void insert(String stateHash, long userId, Instant expiresAt) {
    dsl.insertInto(MAIL_OAUTH_STATE)
        .set(MAIL_OAUTH_STATE.STATE_HASH, stateHash)
        .set(MAIL_OAUTH_STATE.USER_ID, userId)
        .set(MAIL_OAUTH_STATE.EXPIRES_AT, OffsetDateTime.ofInstant(expiresAt, ZoneOffset.UTC))
        .execute();
  }

  /** 해시로 행을 지우며 돌려준다 — 단일 DELETE ... RETURNING 이라 동시에 두 번 불러도 한 쪽만 행을 얻는다(1회 소비). */
  public Optional<Row> deleteReturning(String stateHash) {
    return dsl.deleteFrom(MAIL_OAUTH_STATE)
        .where(MAIL_OAUTH_STATE.STATE_HASH.eq(stateHash))
        .returning(
            MAIL_OAUTH_STATE.USER_ID, MAIL_OAUTH_STATE.TENANT_ID, MAIL_OAUTH_STATE.EXPIRES_AT)
        .fetchOptional()
        .map(r -> new Row(r.getUserId(), r.getTenantId(), r.getExpiresAt().toInstant()));
  }

  /** 해시로 행을 지우지 않고 읽는다 — 다른 워크스페이스에서 마친 콜백을 tenant_mismatch 로 가를 때 state 를 남겨 두려고 쓴다. */
  public Optional<Row> findByHash(String stateHash) {
    return dsl.select(
            MAIL_OAUTH_STATE.USER_ID, MAIL_OAUTH_STATE.TENANT_ID, MAIL_OAUTH_STATE.EXPIRES_AT)
        .from(MAIL_OAUTH_STATE)
        .where(MAIL_OAUTH_STATE.STATE_HASH.eq(stateHash))
        .fetchOptional()
        .map(r -> new Row(r.value1(), r.value2(), r.value3().toInstant()));
  }

  /** 현재 테넌트(RLS)의 만료된 행을 지우고 지운 건수를 돌려준다. */
  public int deleteExpired(Instant now) {
    return dsl.deleteFrom(MAIL_OAUTH_STATE)
        .where(MAIL_OAUTH_STATE.EXPIRES_AT.lt(OffsetDateTime.ofInstant(now, ZoneOffset.UTC)))
        .execute();
  }
}
