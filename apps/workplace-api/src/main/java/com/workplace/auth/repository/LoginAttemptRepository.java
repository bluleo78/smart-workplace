package com.workplace.auth.repository;

import static com.workplace.jooq.Tables.LOGIN_ATTEMPTS;

import lombok.RequiredArgsConstructor;
import org.jooq.DSLContext;
import org.jooq.impl.DSL;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.annotation.Transactional;

/**
 * 로그인 실패 카운터 영속 저장소(#144).
 *
 * <p>{@link #incrementAttempts(String)}는 UPSERT + RETURNING으로 동시 실패 요청의 카운터 증가를 원자적으로 처리한다. 잠금
 * 기간(15분)은 SQL의 {@code interval '15 minutes'}로 인라인된다 — 변경 시 V3 마이그레이션 주석과 본 클래스 SQL을 함께 동기화한다.
 */
@Repository
@RequiredArgsConstructor
public class LoginAttemptRepository {

  /**
   * UPSERT: 신규면 attempts=1, 기존이면 +1. 매 호출마다 expires_at을 now()+15min로 갱신(rolling window). 기존 행이 이미
   * 만료됐으면 1부터 다시 센다(WP-1161) — 조회({@link #getAttempts})가 만료된 행을 0 으로 보는 것과 맞춘다. 전에는 정리 스케줄러가 지우기
   * 전이면 만료된 카운터에 더해 한 번 틀리자마자 다시 잠겼고, 지운 뒤면 다섯 번을 다시 셌다(정리 시점에 따라 갈림).
   */
  private static final String INCREMENT_SQL =
      "INSERT INTO login_attempts (username, attempts, expires_at) "
          + "VALUES (?, 1, now() + interval '15 minutes') "
          + "ON CONFLICT (username) DO UPDATE SET "
          + "  attempts = CASE WHEN login_attempts.expires_at <= now() THEN 1"
          + "    ELSE login_attempts.attempts + 1 END, "
          + "  expires_at = now() + interval '15 minutes', "
          + "  updated_at = now() "
          + "RETURNING attempts";

  private final DSLContext dsl;

  /**
   * 실패 카운터를 원자적으로 1 증가시킨다.
   *
   * <p>REQUIRES_NEW 를 쓰지 않는다(WP-752). 요청 트랜잭션이 커넥션을 쥔 채 두 번째 커넥션을 빌리면, 풀 크기만큼 틀린 로그인이 동시에 들어올 때 모두가
   * 두 번째 커넥션을 기다려 풀 타임아웃까지 API 전체가 멈췄다(인증 없는 서비스 거부). 대신 호출 쪽이 카운터가 롤백되지 않게 한다 — 로그인은 자격 검증을 트랜잭션
   * 밖에서 해 여기서 짧은 트랜잭션이 새로 열리고, 비밀번호 변경은 불일치 예외에 롤백하지 않는 트랜잭션에 함께 커밋한다.
   *
   * @return 증가 후 카운터 값
   */
  @Transactional
  public int incrementAttempts(String username) {
    return dsl.fetchOne(INCREMENT_SQL, username).get(0, Integer.class);
  }

  /**
   * 만료되지 않은 시도 카운터. row가 없거나 만료됐으면 0. 만료 비교는 UPSERT 가 expires_at 을 쓸 때와 같은 DB 시계로 한다 — JVM 시계로 하면
   * DB 와 시계가 어긋날 때(멀티 인스턴스, 컨테이너 VM 시계 지연) 잠금이 일찍·늦게 풀린다(WP-434).
   */
  public int getAttempts(String username) {
    Integer attempts =
        dsl.select(LOGIN_ATTEMPTS.ATTEMPTS)
            .from(LOGIN_ATTEMPTS)
            .where(LOGIN_ATTEMPTS.USERNAME.eq(username))
            .and(LOGIN_ATTEMPTS.EXPIRES_AT.gt(DSL.currentLocalDateTime()))
            .fetchOne(LOGIN_ATTEMPTS.ATTEMPTS);
    return attempts == null ? 0 : attempts;
  }

  /** 성공 로그인 시 카운터 제거. 증가와 같은 이유로 두 번째 커넥션을 빌리지 않는다(WP-752). */
  @Transactional
  public void clear(String username) {
    dsl.deleteFrom(LOGIN_ATTEMPTS).where(LOGIN_ATTEMPTS.USERNAME.eq(username)).execute();
  }

  /** 만료된 row(DB 시계 기준)를 일괄 삭제하고 삭제 건수를 반환한다(스케줄러용). */
  @Transactional
  public int deleteExpired() {
    return dsl.deleteFrom(LOGIN_ATTEMPTS)
        .where(LOGIN_ATTEMPTS.EXPIRES_AT.lt(DSL.currentLocalDateTime()))
        .execute();
  }
}
