package com.workplace.drive.repository;

import static com.workplace.jooq.Tables.DRIVE_SHARE_LINK_ATTEMPTS;

import java.time.LocalDateTime;
import lombok.RequiredArgsConstructor;
import org.jooq.DSLContext;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

/**
 * 공유 링크 비밀번호 실패 카운터 영속 저장소(#700).
 *
 * <p>{@code LoginAttemptRepository}(#144)와 동일 패턴 — 키만 username 대신 공유 토큰의 SHA-256 hex(token_hash)를
 * 사용한다. {@link #incrementAttempts(String)}는 UPSERT + RETURNING으로 동시 실패 요청의 카운터 증가를 원자적으로 처리한다. 잠금
 * 기간(15분)은 V121 마이그레이션과 동일하게 SQL에 인라인된다.
 */
@Repository
@RequiredArgsConstructor
public class DriveShareLinkAttemptRepository {

  /** UPSERT: 신규면 attempts=1, 기존이면 +1. 매 호출마다 expires_at을 now()+15min로 갱신(rolling window). */
  private static final String INCREMENT_SQL =
      "INSERT INTO drive_share_link_attempts (token_hash, attempts, expires_at) "
          + "VALUES (?, 1, now() + interval '15 minutes') "
          + "ON CONFLICT (token_hash) DO UPDATE SET "
          + "  attempts = drive_share_link_attempts.attempts + 1, "
          + "  expires_at = now() + interval '15 minutes', "
          + "  updated_at = now() "
          + "RETURNING attempts";

  private final DSLContext dsl;

  /**
   * 실패 카운터를 원자적으로 1 증가시킨다. 부모 트랜잭션이 롤백돼도 카운터는 유지되도록 REQUIRES_NEW로 독립 커밋한다.
   *
   * @return 증가 후 카운터 값
   */
  @Transactional(propagation = Propagation.REQUIRES_NEW)
  public int incrementAttempts(String tokenHash) {
    return dsl.fetchOne(INCREMENT_SQL, tokenHash).get(0, Integer.class);
  }

  /** 만료되지 않은 시도 카운터. row가 없거나 만료됐으면 0. */
  public int getAttempts(String tokenHash) {
    Integer attempts =
        dsl.select(DRIVE_SHARE_LINK_ATTEMPTS.ATTEMPTS)
            .from(DRIVE_SHARE_LINK_ATTEMPTS)
            .where(DRIVE_SHARE_LINK_ATTEMPTS.TOKEN_HASH.eq(tokenHash))
            .and(DRIVE_SHARE_LINK_ATTEMPTS.EXPIRES_AT.gt(LocalDateTime.now()))
            .fetchOne(DRIVE_SHARE_LINK_ATTEMPTS.ATTEMPTS);
    return attempts == null ? 0 : attempts;
  }

  /** 비밀번호 검증 성공 시 카운터 제거. */
  @Transactional(propagation = Propagation.REQUIRES_NEW)
  public void clear(String tokenHash) {
    dsl.deleteFrom(DRIVE_SHARE_LINK_ATTEMPTS)
        .where(DRIVE_SHARE_LINK_ATTEMPTS.TOKEN_HASH.eq(tokenHash))
        .execute();
  }

  /** 만료된 row를 일괄 삭제하고 삭제 건수를 반환한다(스케줄러용). */
  @Transactional
  public int deleteExpired() {
    return dsl.deleteFrom(DRIVE_SHARE_LINK_ATTEMPTS)
        .where(DRIVE_SHARE_LINK_ATTEMPTS.EXPIRES_AT.lt(LocalDateTime.now()))
        .execute();
  }
}
