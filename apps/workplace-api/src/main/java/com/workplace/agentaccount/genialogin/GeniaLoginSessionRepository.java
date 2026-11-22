package com.workplace.agentaccount.genialogin;

import static com.workplace.jooq.Tables.GENIA_LOGIN_SESSION;

import java.time.Duration;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.Optional;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.jooq.DSLContext;
import org.springframework.stereotype.Repository;

/**
 * Gen:iA 로그인 진행 저장소(WP-1976) — genia_login_session.
 *
 * <p>진행 상태를 DB 에 두어 시작·조회·취소가 서로 다른 파드로 가도 이어지게 한다. 폴링 임대(poll_lease_*)로 여러 파드 중 한 곳만 Gen:iA 를
 * 폴링하며, 폴링 결과는 임대 토큰이 일치할 때만 반영한다. 시각 비교는 모두 호출자가 준 값으로 하고 SQL 의 now() 를 쓰지 않는다(서비스 시계와 일치). RLS 를
 * 쓰므로 호출자의 트랜잭션(GUC) 안에서 불러야 한다. code_verifier·state 는 암호화된 채로만 다루고, 끝나면 NULL 로 지운다.
 */
@Repository
@RequiredArgsConstructor
public class GeniaLoginSessionRepository {

  private final DSLContext dsl;

  /**
   * 진행 한 건의 스냅샷. verifierEnc·stateEnc 는 암호문이며 toString 에서 뺀다.
   *
   * @param verifierEnc 암호화한 code_verifier(끝나면 null)
   * @param stateEnc 암호화한 state(끝나면 null)
   */
  public record Row(
      String loginId,
      long tenantId,
      long userId,
      Long accountId,
      String expectedEmail,
      String label,
      String verifierEnc,
      String stateEnc,
      String authorizeUrl,
      Instant expiresAt,
      int intervalSeconds,
      Instant nextPollAt,
      String status,
      Long resultAccountId,
      String resultEmail,
      String errorMessage) {

    /** 비밀(암호문 포함)과 진행 id 를 뺀 메타만. */
    @Override
    public String toString() {
      return "GeniaLoginSessionRow[userId="
          + userId
          + ", accountId="
          + accountId
          + ", status="
          + status
          + ", expiresAt="
          + expiresAt
          + "]";
    }
  }

  private static OffsetDateTime ts(Instant t) {
    return OffsetDateTime.ofInstant(t, ZoneOffset.UTC);
  }

  /** 같은 (테넌트, 사용자)의 이전 진행을 지운다 — 호출자가 삽입과 한 트랜잭션으로 묶는다. */
  public void deleteByUser(long tenantId, long userId) {
    dsl.deleteFrom(GENIA_LOGIN_SESSION)
        .where(GENIA_LOGIN_SESSION.TENANT_ID.eq(tenantId))
        .and(GENIA_LOGIN_SESSION.USER_ID.eq(userId))
        .execute();
  }

  /**
   * 새 진행을 넣는다. 동시에 같은 사람이 시작해 유일 제약과 부딪치면 오류 없이 false(트랜잭션이 깨지지 않게 ON CONFLICT DO NOTHING) — 호출자가 한
   * 번 다시 시도한다.
   */
  public boolean insert(Row r) {
    return dsl.insertInto(GENIA_LOGIN_SESSION)
            .set(GENIA_LOGIN_SESSION.TENANT_ID, r.tenantId())
            .set(GENIA_LOGIN_SESSION.LOGIN_ID, r.loginId())
            .set(GENIA_LOGIN_SESSION.USER_ID, r.userId())
            .set(GENIA_LOGIN_SESSION.ACCOUNT_ID, r.accountId())
            .set(GENIA_LOGIN_SESSION.EXPECTED_EMAIL, r.expectedEmail())
            .set(GENIA_LOGIN_SESSION.LABEL, r.label())
            .set(GENIA_LOGIN_SESSION.VERIFIER_ENC, r.verifierEnc())
            .set(GENIA_LOGIN_SESSION.STATE_ENC, r.stateEnc())
            .set(GENIA_LOGIN_SESSION.AUTHORIZE_URL, r.authorizeUrl())
            .set(GENIA_LOGIN_SESSION.EXPIRES_AT, ts(r.expiresAt()))
            .set(GENIA_LOGIN_SESSION.INTERVAL_SECONDS, r.intervalSeconds())
            .set(GENIA_LOGIN_SESSION.NEXT_POLL_AT, ts(r.nextPollAt()))
            .set(GENIA_LOGIN_SESSION.STATUS, r.status())
            .onConflictDoNothing()
            .execute()
        == 1;
  }

  /** 이 사용자의 진행 id 로 읽는다 — RLS 로 다른 테넌트 행은 보이지 않고, 남의 진행은 사용자 조건으로 거른다. */
  public Optional<Row> find(String loginId, long userId) {
    return dsl.selectFrom(GENIA_LOGIN_SESSION)
        .where(GENIA_LOGIN_SESSION.LOGIN_ID.eq(loginId))
        .and(GENIA_LOGIN_SESSION.USER_ID.eq(userId))
        .fetchOptional(
            r ->
                new Row(
                    r.getLoginId(),
                    r.getTenantId(),
                    r.getUserId(),
                    r.getAccountId(),
                    r.getExpectedEmail(),
                    r.getLabel(),
                    r.getVerifierEnc(),
                    r.getStateEnc(),
                    r.getAuthorizeUrl(),
                    r.getExpiresAt().toInstant(),
                    r.getIntervalSeconds(),
                    r.getNextPollAt().toInstant(),
                    r.getStatus(),
                    r.getResultAccountId(),
                    r.getResultEmail(),
                    r.getErrorMessage()));
  }

  /** 만료 시각 + retain 이 지난 현재 테넌트(RLS)의 진행을 쓸어 낸다. */
  public int sweep(Instant now, Duration retain) {
    return dsl.deleteFrom(GENIA_LOGIN_SESSION)
        .where(GENIA_LOGIN_SESSION.EXPIRES_AT.lt(ts(now.minus(retain))))
        .execute();
  }

  /** 비밀 지우기 여유 — 파드 사이 시계가 조금 어긋나도 아직 만료 전으로 보는 파드가 폴링할 진행의 비밀을 지우지 않게. */
  static final Duration CLEAR_SECRETS_GRACE = Duration.ofMinutes(1);

  /**
   * 만료 시각이 여유({@link #CLEAR_SECRETS_GRACE})만큼 지났고 폴링 임대가 없거나 끝난 현재 테넌트(RLS) 진행의
   * 암호문(verifier·state)을 지운다 — 창을 닫아 버려진 진행의 비밀이 쓸기 전까지 남지 않게.
   */
  public int clearExpiredSecrets(Instant now) {
    return dsl.update(GENIA_LOGIN_SESSION)
        .setNull(GENIA_LOGIN_SESSION.VERIFIER_ENC)
        .setNull(GENIA_LOGIN_SESSION.STATE_ENC)
        .where(GENIA_LOGIN_SESSION.EXPIRES_AT.lt(ts(now.minus(CLEAR_SECRETS_GRACE))))
        .and(
            GENIA_LOGIN_SESSION
                .POLL_LEASE_UNTIL
                .isNull()
                .or(GENIA_LOGIN_SESSION.POLL_LEASE_UNTIL.lt(ts(now))))
        .and(
            GENIA_LOGIN_SESSION
                .VERIFIER_ENC
                .isNotNull()
                .or(GENIA_LOGIN_SESSION.STATE_ENC.isNotNull()))
        .execute();
  }

  /**
   * 대기 중인 진행을 EXPIRED 로 끝낸다(조건부 — 이미 끝났으면 0건). 비밀을 지우고 임대를 푼다. 폴링 임대가 아직 살아 있으면(임대 없음 또는 만료 시각 경과만
   * 허용) 끝내지 않는다 — 폴링 중인 쪽이 성공해 계정을 저장하는데 EXPIRED 로 보이는 불일치를 막고, 폴링이 먼저 끝나게 한다.
   */
  public boolean expireIfPending(String loginId, Instant now) {
    return dsl.update(GENIA_LOGIN_SESSION)
            .set(GENIA_LOGIN_SESSION.STATUS, "EXPIRED")
            .setNull(GENIA_LOGIN_SESSION.VERIFIER_ENC)
            .setNull(GENIA_LOGIN_SESSION.STATE_ENC)
            .setNull(GENIA_LOGIN_SESSION.POLL_LEASE_TOKEN)
            .setNull(GENIA_LOGIN_SESSION.POLL_LEASE_UNTIL)
            .set(GENIA_LOGIN_SESSION.UPDATED_AT, ts(now))
            .where(GENIA_LOGIN_SESSION.LOGIN_ID.eq(loginId))
            .and(GENIA_LOGIN_SESSION.STATUS.eq("PENDING"))
            .and(
                GENIA_LOGIN_SESSION
                    .POLL_LEASE_UNTIL
                    .isNull()
                    .or(GENIA_LOGIN_SESSION.POLL_LEASE_UNTIL.lt(ts(now))))
            .execute()
        == 1;
  }

  /** 폴링 임대를 잡는다 — 단일 조건부 UPDATE 라 동시에 불러도 한 쪽만 true. 조건: 대기 중·폴링 간격 지남·(임대 없음 또는 만료). */
  public boolean tryAcquireLease(String loginId, UUID token, Instant now, Instant leaseUntil) {
    return dsl.update(GENIA_LOGIN_SESSION)
            .set(GENIA_LOGIN_SESSION.POLL_LEASE_TOKEN, token)
            .set(GENIA_LOGIN_SESSION.POLL_LEASE_UNTIL, ts(leaseUntil))
            .set(GENIA_LOGIN_SESSION.UPDATED_AT, ts(now))
            .where(GENIA_LOGIN_SESSION.LOGIN_ID.eq(loginId))
            .and(GENIA_LOGIN_SESSION.STATUS.eq("PENDING"))
            .and(GENIA_LOGIN_SESSION.NEXT_POLL_AT.le(ts(now)))
            .and(
                GENIA_LOGIN_SESSION
                    .POLL_LEASE_UNTIL
                    .isNull()
                    .or(GENIA_LOGIN_SESSION.POLL_LEASE_UNTIL.lt(ts(now))))
            .execute()
        == 1;
  }

  /**
   * 저장 직전 임대 확인·연장 — 임대 토큰이 이 호출의 것이고 대기 중일 때만 임대 만료를 늘린다(조건부 UPDATE 한 번). 0건이면 임대가 끊겨 다른 파드가
   * 이어받았거나 취소·만료로 끝난 것이라 호출자는 계정을 저장하지 않는다. 시각은 호출자가 준 값만 쓴다.
   */
  public boolean claimForSave(
      String loginId, long userId, UUID token, Instant now, Instant leaseUntil) {
    return dsl.update(GENIA_LOGIN_SESSION)
            .set(GENIA_LOGIN_SESSION.POLL_LEASE_UNTIL, ts(leaseUntil))
            .set(GENIA_LOGIN_SESSION.UPDATED_AT, ts(now))
            .where(GENIA_LOGIN_SESSION.LOGIN_ID.eq(loginId))
            .and(GENIA_LOGIN_SESSION.USER_ID.eq(userId))
            .and(GENIA_LOGIN_SESSION.POLL_LEASE_TOKEN.eq(token))
            .and(GENIA_LOGIN_SESSION.STATUS.eq("PENDING"))
            .execute()
        == 1;
  }

  /** 계속 대기 — 임대 토큰이 일치할 때만 다음 폴링 시각·간격을 반영하고 임대를 푼다. */
  public boolean continuePending(
      String loginId, UUID token, Instant now, Instant nextPollAt, int intervalSeconds) {
    return dsl.update(GENIA_LOGIN_SESSION)
            .set(GENIA_LOGIN_SESSION.NEXT_POLL_AT, ts(nextPollAt))
            .set(GENIA_LOGIN_SESSION.INTERVAL_SECONDS, intervalSeconds)
            .setNull(GENIA_LOGIN_SESSION.POLL_LEASE_TOKEN)
            .setNull(GENIA_LOGIN_SESSION.POLL_LEASE_UNTIL)
            .set(GENIA_LOGIN_SESSION.UPDATED_AT, ts(now))
            .where(GENIA_LOGIN_SESSION.LOGIN_ID.eq(loginId))
            .and(GENIA_LOGIN_SESSION.POLL_LEASE_TOKEN.eq(token))
            .execute()
        == 1;
  }

  /** 진행 끝 — 임대 토큰이 일치할 때만 상태·결과를 반영하고 비밀을 지우며 임대를 푼다. */
  public boolean finish(
      String loginId,
      UUID token,
      Instant now,
      String status,
      String errorMessage,
      Long resultAccountId,
      String resultEmail) {
    return dsl.update(GENIA_LOGIN_SESSION)
            .set(GENIA_LOGIN_SESSION.STATUS, status)
            .set(GENIA_LOGIN_SESSION.ERROR_MESSAGE, errorMessage)
            .set(GENIA_LOGIN_SESSION.RESULT_ACCOUNT_ID, resultAccountId)
            .set(GENIA_LOGIN_SESSION.RESULT_EMAIL, resultEmail)
            .setNull(GENIA_LOGIN_SESSION.VERIFIER_ENC)
            .setNull(GENIA_LOGIN_SESSION.STATE_ENC)
            .setNull(GENIA_LOGIN_SESSION.POLL_LEASE_TOKEN)
            .setNull(GENIA_LOGIN_SESSION.POLL_LEASE_UNTIL)
            .set(GENIA_LOGIN_SESSION.UPDATED_AT, ts(now))
            .where(GENIA_LOGIN_SESSION.LOGIN_ID.eq(loginId))
            .and(GENIA_LOGIN_SESSION.POLL_LEASE_TOKEN.eq(token))
            .execute()
        == 1;
  }

  /**
   * 임대 토큰 없이 대기 중인 진행을 성공으로 끝낸다 — 계정을 저장한 뒤 임대가 끊겨 토큰 조건 {@link #finish} 가 0건일 때만 쓴다. 대기 중일 때만(이미
   * 끝났으면 0건) 반영하고 비밀을 지우며 임대를 푼다.
   */
  public boolean finishPendingWithoutLease(
      String loginId, long userId, Instant now, long resultAccountId, String resultEmail) {
    return dsl.update(GENIA_LOGIN_SESSION)
            .set(GENIA_LOGIN_SESSION.STATUS, "SUCCEEDED")
            .setNull(GENIA_LOGIN_SESSION.ERROR_MESSAGE)
            .set(GENIA_LOGIN_SESSION.RESULT_ACCOUNT_ID, resultAccountId)
            .set(GENIA_LOGIN_SESSION.RESULT_EMAIL, resultEmail)
            .setNull(GENIA_LOGIN_SESSION.VERIFIER_ENC)
            .setNull(GENIA_LOGIN_SESSION.STATE_ENC)
            .setNull(GENIA_LOGIN_SESSION.POLL_LEASE_TOKEN)
            .setNull(GENIA_LOGIN_SESSION.POLL_LEASE_UNTIL)
            .set(GENIA_LOGIN_SESSION.UPDATED_AT, ts(now))
            .where(GENIA_LOGIN_SESSION.LOGIN_ID.eq(loginId))
            // 남의 진행은 사용자 조건으로 거른다(find·claimForSave·deleteByLoginId 와 같은 가드).
            .and(GENIA_LOGIN_SESSION.USER_ID.eq(userId))
            .and(GENIA_LOGIN_SESSION.STATUS.eq("PENDING"))
            .execute()
        == 1;
  }

  /** 진행 id 로 진행 행을 지운다(취소 — 남의 진행은 사용자 조건으로 거른다). 사용자 단위 삭제 {@link #deleteByUser} 와 구분한다. */
  public void deleteByLoginId(String loginId, long userId) {
    dsl.deleteFrom(GENIA_LOGIN_SESSION)
        .where(GENIA_LOGIN_SESSION.LOGIN_ID.eq(loginId))
        .and(GENIA_LOGIN_SESSION.USER_ID.eq(userId))
        .execute();
  }
}
