package com.workplace.drive.repository;

import static com.workplace.jooq.Tables.DRIVE_SHARE_LINK_ATTEMPTS;

import lombok.RequiredArgsConstructor;
import org.jooq.DSLContext;
import org.jooq.impl.DSL;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

/**
 * 공유 링크 비밀번호 실패 카운터 영속 저장소(#700).
 *
 * <p>{@code LoginAttemptRepository}(#144)와 같은 표를 쓰되 키는 username 대신 공유 토큰의 SHA-256 hex(token_hash)다.
 * {@link #reserveAttempt(String, int)}는 비밀번호를 비교하기 <b>전에</b> 시도 한 칸을 조건부 UPSERT 로 잡는다(WP-783) —
 * 「잠겼나 확인 → 비교 → 실패 증가」로 나눠 두면 동시 요청이 모두 확인을 통과한 뒤에야 카운터가 올라 상한이 무력해졌다. 잠금 기간(15분)은 V121 마이그레이션과
 * 동일하게 SQL에 인라인된다.
 */
@Repository
@RequiredArgsConstructor
public class DriveShareLinkAttemptRepository {

  /**
   * 조건부 UPSERT: 행이 없거나 만료됐으면 1 로 새로 시작하고, 상한 미만이면 +1. 상한에 닿은 채 만료 전이면 WHERE 에 걸려 아무 행도 돌려주지 않는다 (=
   * 잠김). 같은 행의 동시 UPSERT 는 행 잠금으로 줄을 서므로 상한을 넘겨 잡히는 칸이 없다. 매번 expires_at 을 now()+15분으로 미룬다(rolling
   * window).
   */
  private static final String RESERVE_SQL =
      "INSERT INTO drive_share_link_attempts (token_hash, attempts, expires_at) "
          + "VALUES (?, 1, now() + interval '15 minutes') "
          + "ON CONFLICT (token_hash) DO UPDATE SET "
          + "  attempts = CASE WHEN drive_share_link_attempts.expires_at <= now() THEN 1 "
          + "                  ELSE drive_share_link_attempts.attempts + 1 END, "
          + "  expires_at = now() + interval '15 minutes', "
          + "  updated_at = now() "
          + "WHERE drive_share_link_attempts.expires_at <= now() "
          + "   OR drive_share_link_attempts.attempts < ? "
          + "RETURNING attempts";

  private final DSLContext dsl;

  /**
   * 시도 한 칸을 원자적으로 잡는다. 부모 트랜잭션이 롤백돼도 남도록 REQUIRES_NEW 로 독립 커밋한다 — 비교에 성공하면 호출자가 {@link
   * #clear(String)} 로 지우고, 실패하면 잡은 칸이 곧 실패 기록이 된다.
   *
   * @return 잡은 뒤의 시도 횟수(1..maxAttempts), 이미 상한이라 잠겼으면 0
   */
  @Transactional(propagation = Propagation.REQUIRES_NEW)
  public int reserveAttempt(String tokenHash, int maxAttempts) {
    var row = dsl.fetchOptional(RESERVE_SQL, tokenHash, maxAttempts);
    return row.map(r -> r.get(0, Integer.class)).orElse(0);
  }

  /**
   * 만료되지 않은 시도 카운터. row가 없거나 만료됐으면 0. 만료 비교는 UPSERT 가 expires_at 을 쓸 때와 같은 DB 시계로 한다 — JVM 시계로 하면
   * DB 와 시계가 어긋날 때(멀티 인스턴스, 컨테이너 VM 시계 지연) 잠금이 일찍·늦게 풀린다(WP-434).
   */
  public int getAttempts(String tokenHash) {
    Integer attempts =
        dsl.select(DRIVE_SHARE_LINK_ATTEMPTS.ATTEMPTS)
            .from(DRIVE_SHARE_LINK_ATTEMPTS)
            .where(DRIVE_SHARE_LINK_ATTEMPTS.TOKEN_HASH.eq(tokenHash))
            .and(DRIVE_SHARE_LINK_ATTEMPTS.EXPIRES_AT.gt(DSL.currentLocalDateTime()))
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

  /** 만료된 row(DB 시계 기준)를 일괄 삭제하고 삭제 건수를 반환한다(스케줄러용). */
  @Transactional
  public int deleteExpired() {
    return dsl.deleteFrom(DRIVE_SHARE_LINK_ATTEMPTS)
        .where(DRIVE_SHARE_LINK_ATTEMPTS.EXPIRES_AT.lt(DSL.currentLocalDateTime()))
        .execute();
  }
}
