package com.workplace.agentaccount.refresh;

import static com.workplace.jooq.Tables.AGENT_ACCOUNT_LOGIN_REFRESH;

import com.workplace.global.util.Texts;
import java.time.Duration;
import lombok.RequiredArgsConstructor;
import org.jooq.DSLContext;
import org.jooq.impl.DSL;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.annotation.Transactional;

/**
 * 로그인 갱신 시도 기록(agent_account_login_refresh) jOOQ 리포지토리(WP-1450). 계정당 한 행에 임대·마지막 시도·성공·실패 이유를 둔다.
 * 테넌트 격리는 RLS + tenant_id GUC DEFAULT 로 보장되므로 RLS 아래에서 도는 메서드는 {@code @Transactional} 안에서 호출된다.
 */
@Repository
@RequiredArgsConstructor
public class LoginRefreshRepository {

  private final DSLContext dsl;

  /**
   * 이 계정을 지금 갱신할 권한을 원자적으로 잡는다. 행이 없으면 만들고, 있으면 임대가 없거나 만료일 때만 임대를 다시 건다. 한 문장(INSERT … ON CONFLICT
   * DO UPDATE … WHERE … RETURNING)이라 여러 대·여러 회차가 동시에 와도 한쪽만 true 를 받는다. 시각은 DB 시계(now())로 판정한다 — 서버
   * 간 시계 차이를 피한다. 갱신 토큰은 1회용이라 같은 계정을 동시에 갱신하면 한쪽이 영구 실패하기 때문에 이 한 번뿐인 권한이 중요하다.
   *
   * @return 선점에 성공했는가(false 면 다른 쪽이 갱신 중)
   */
  @Transactional
  public boolean tryClaim(long tenantId, long accountId, Duration lease) {
    long leaseSeconds = lease.toSeconds();
    return dsl.fetchOptional(
            "INSERT INTO agent_account_login_refresh (tenant_id, account_id, lease_until) "
                + "VALUES (?, ?, now() + (? * interval '1 second')) "
                + "ON CONFLICT (account_id) DO UPDATE "
                + "SET lease_until = now() + (? * interval '1 second') "
                + "WHERE agent_account_login_refresh.lease_until IS NULL "
                + "OR agent_account_login_refresh.lease_until < now() "
                + "RETURNING account_id",
            tenantId,
            accountId,
            leaseSeconds,
            leaseSeconds)
        .isPresent();
  }

  /** 갱신 성공을 기록한다 — 시도·성공 시각(DB 시계), 실패 이유 비움, 임대 해제. */
  @Transactional
  public void recordSuccess(long accountId) {
    dsl.update(AGENT_ACCOUNT_LOGIN_REFRESH)
        .set(AGENT_ACCOUNT_LOGIN_REFRESH.ATTEMPTED_AT, DSL.currentOffsetDateTime())
        .set(AGENT_ACCOUNT_LOGIN_REFRESH.SUCCEEDED_AT, DSL.currentOffsetDateTime())
        .setNull(AGENT_ACCOUNT_LOGIN_REFRESH.ERROR_CODE)
        .setNull(AGENT_ACCOUNT_LOGIN_REFRESH.ERROR_MESSAGE)
        .setNull(AGENT_ACCOUNT_LOGIN_REFRESH.LEASE_UNTIL)
        .where(AGENT_ACCOUNT_LOGIN_REFRESH.ACCOUNT_ID.eq(accountId))
        .execute();
  }

  /**
   * 갱신 실패를 기록한다 — 시도 시각과 실패 이유만 쓰고 마지막 성공 시각은 남긴다. 임대 해제.
   *
   * @param errorCode 실패 코드(토큰 등 평문 금지)
   * @param errorMessage 짧은 한국어 문구
   */
  @Transactional
  public void recordFailure(long accountId, String errorCode, String errorMessage) {
    // 칸 길이를 넘기면 트랜잭션 전체(계정 상태 변경 포함)가 되돌려진다 — 어떤 입력에도 넘지 않게 자른다.
    String code = Texts.headUtf16(errorCode, 64);
    String message = Texts.headUtf16(errorMessage, 500);
    dsl.update(AGENT_ACCOUNT_LOGIN_REFRESH)
        .set(AGENT_ACCOUNT_LOGIN_REFRESH.ATTEMPTED_AT, DSL.currentOffsetDateTime())
        .set(AGENT_ACCOUNT_LOGIN_REFRESH.ERROR_CODE, code)
        .set(AGENT_ACCOUNT_LOGIN_REFRESH.ERROR_MESSAGE, message)
        .setNull(AGENT_ACCOUNT_LOGIN_REFRESH.LEASE_UNTIL)
        .where(AGENT_ACCOUNT_LOGIN_REFRESH.ACCOUNT_ID.eq(accountId))
        .execute();
  }

  /** 결과를 남기지 않고 임대만 푼다 — 갱신 중 폐기·원문 교체로 결과를 버릴 때, 또는 예상 못 한 예외로 끝났을 때. */
  @Transactional
  public void releaseLease(long accountId) {
    dsl.update(AGENT_ACCOUNT_LOGIN_REFRESH)
        .setNull(AGENT_ACCOUNT_LOGIN_REFRESH.LEASE_UNTIL)
        .where(AGENT_ACCOUNT_LOGIN_REFRESH.ACCOUNT_ID.eq(accountId))
        .execute();
  }
}
