package com.workplace.agentaccount.usage;

import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.agentaccount.repository.AgentAccountBindingRepository;
import com.workplace.agentaccount.repository.AgentAccountRepository;
import com.workplace.global.tenant.TenantContext;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.TestFixtures;
import java.math.BigDecimal;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import org.jooq.DSLContext;
import org.jooq.impl.DSL;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.annotation.Transactional;

/**
 * WP-1449 AI 계정 사용량 저장소 통합 테스트 — 임대 선점(tryClaim)과 간격 여유 경계, 성공·실패 저장 시 스냅샷 보존(시도 시각은 DB 시계), 원문 교체
 * 시 사용량 비우기, 마지막 사용 시각 갱신 간격, 테넌트 격리(RLS)를 확인한다.
 */
@Transactional
class AgentAccountUsageRepositoryTest extends IntegrationTestBase {

  @Autowired DSLContext dsl;
  @Autowired AgentAccountRepository accounts;
  @Autowired AgentAccountBindingRepository bindings;
  @Autowired AgentAccountUsageRepository usage;

  private long account;
  private long agent;

  /** 워크스페이스 1 에 계정 하나와 그 계정에 묶인 AI 하나를 시드한다. */
  @BeforeEach
  void seed() {
    TenantContext.set(1L);
    agent = TestFixtures.activeMemberOfCurrentTenant(dsl, TestFixtures.createAgentNoToken(dsl));
    account = accounts.insert("anthropic", "사용량", "iv:cipher", null, null, "ACTIVE", null, null);
    bindings.upsert(agent, account, null, null, null);
  }

  private UsageSnapshot snap(UsageWindow w, String pct, Instant at) {
    return new UsageSnapshot(w, new BigDecimal(pct), at.plusSeconds(3600), "allowed", at);
  }

  @Test
  void tryClaim_firstWins_secondFalse() {
    assertThat(usage.tryClaim(1L, account, Duration.ofMinutes(10), Duration.ofMinutes(2))).isTrue();
    assertThat(usage.tryClaim(1L, account, Duration.ofMinutes(10), Duration.ofMinutes(2)))
        .isFalse();
  }

  @Test
  void tryClaim_afterIntervalAgain_true() {
    assertThat(usage.tryClaim(1L, account, Duration.ofMinutes(10), Duration.ofMinutes(2))).isTrue();
    // 임대가 풀리고 마지막 시도가 간격보다 오래된 상태를 만든다.
    dsl.execute(
        "UPDATE agent_account_usage_check SET checked_at = now() - interval '11 minutes',"
            + " lease_until = NULL WHERE account_id = ?",
        account);
    assertThat(usage.tryClaim(1L, account, Duration.ofMinutes(10), Duration.ofMinutes(2))).isTrue();
  }

  /** 마지막 시도 시각을 DB 시계 기준 now() + offset 초로 두고 임대를 푼다. */
  private void setCheckedAt(long offsetSeconds) {
    dsl.execute(
        "UPDATE agent_account_usage_check SET checked_at = now() + (? * interval '1 second'),"
            + " lease_until = NULL WHERE account_id = ?",
        offsetSeconds,
        account);
  }

  @Test
  void tryClaim_slackBoundary() {
    Duration interval = Duration.ofMinutes(10);
    Duration lease = Duration.ofMinutes(2);
    assertThat(usage.tryClaim(1L, account, interval, lease)).isTrue();
    // 간격보다 몇 초 덜 지났어도(fixedDelay 로 바로 다음 회차·시계 오차) 여유(min(lease, interval/2)=2분) 안이라 잡힌다
    setCheckedAt(-interval.toSeconds() + 5);
    assertThat(usage.tryClaim(1L, account, interval, lease)).isTrue();
    // 방금(몇 초 전) 시도했으면 잡히지 않는다
    setCheckedAt(-5);
    assertThat(usage.tryClaim(1L, account, interval, lease)).isFalse();
    // 여유 경계 바깥(간격 - 여유 보다 덜 지남)도 잡히지 않는다
    setCheckedAt(-(interval.toSeconds() - lease.toSeconds()) + 5);
    assertThat(usage.tryClaim(1L, account, interval, lease)).isFalse();
  }

  @Test
  void resetForNewSecret_clearsUsage_keepsLastUsedAndLease() {
    Instant t0 = Instant.parse("2026-11-09T00:00:00Z");
    usage.touchLastUsed(List.of(agent), t0);
    usage.saveSuccess(account, List.of(snap(UsageWindow.FIVE_HOUR, "95.00", t0)), true);
    usage.saveFailure(account, "TOKEN_EXPIRED", "토큰 만료");
    // 옛 키로 조회가 도는 중(임대 잡힘)인 상태를 만든다
    dsl.execute(
        "UPDATE agent_account_usage_check SET lease_until = now() + interval '1 minute'"
            + " WHERE account_id = ?",
        account);

    usage.resetForNewSecret(account);

    assertThat(usage.findSnapshots(List.of(account))).doesNotContainKey(account);
    UsageCheckRow check = usage.findChecks(List.of(account)).get(account);
    assertThat(check.checkedAt()).isNull();
    assertThat(check.succeededAt()).isNull();
    assertThat(check.errorCode()).isNull();
    assertThat(check.errorMessage()).isNull();
    assertThat(check.limitReached()).isFalse();
    assertThat(check.lastUsedAt()).isEqualTo(t0);
    assertThat(
            dsl.fetchValue(
                "SELECT lease_until FROM agent_account_usage_check WHERE account_id = ?", account))
        .isNotNull();
    // 옛 조회가 결과를 버리고 임대를 풀면 간격을 기다리지 않고 바로 잡힌다
    usage.releaseLease(account);
    assertThat(usage.tryClaim(1L, account, Duration.ofMinutes(10), Duration.ofMinutes(2))).isTrue();
  }

  @Test
  void releaseLease_letsNextClaimInImmediately() {
    assertThat(usage.tryClaim(1L, account, Duration.ofMinutes(10), Duration.ofMinutes(2))).isTrue();
    usage.releaseLease(account);
    // 결과를 남기지 않았으므로(checked_at NULL) 임대만 풀리면 바로 다시 잡힌다.
    assertThat(usage.findChecks(List.of(account)).get(account).checkedAt()).isNull();
    assertThat(usage.tryClaim(1L, account, Duration.ofMinutes(10), Duration.ofMinutes(2))).isTrue();
  }

  @Test
  void saveSuccess_upsertsOnlyGivenWindows() {
    Instant t0 = Instant.parse("2026-11-09T00:00:00Z");
    usage.saveSuccess(
        account,
        List.of(snap(UsageWindow.FIVE_HOUR, "10.00", t0), snap(UsageWindow.WEEKLY, "20.00", t0)),
        false);
    Instant t1 = t0.plusSeconds(600);
    usage.saveSuccess(account, List.of(snap(UsageWindow.FIVE_HOUR, "55.50", t1)), true);

    List<UsageSnapshot> got = usage.findSnapshots(List.of(account)).get(account);
    assertThat(got).hasSize(2);
    UsageSnapshot five =
        got.stream().filter(s -> s.window() == UsageWindow.FIVE_HOUR).findFirst().orElseThrow();
    UsageSnapshot week =
        got.stream().filter(s -> s.window() == UsageWindow.WEEKLY).findFirst().orElseThrow();
    assertThat(five.usedPercent()).isEqualByComparingTo("55.50");
    assertThat(five.observedAt()).isEqualTo(t1);
    assertThat(week.usedPercent()).isEqualByComparingTo("20.00");
    assertThat(week.observedAt()).isEqualTo(t0);

    UsageCheckRow check = usage.findChecks(List.of(account)).get(account);
    // 시도·성공 시각은 DB 시계(now())로 쓰인다 — tryClaim 의 간격 판정과 같은 시계
    Instant dbNow = dsl.fetchValue(DSL.select(DSL.currentOffsetDateTime())).toInstant();
    assertThat(check.checkedAt()).isEqualTo(dbNow);
    assertThat(check.succeededAt()).isEqualTo(dbNow);
    assertThat(check.limitReached()).isTrue();
    assertThat(check.errorCode()).isNull();
  }

  @Test
  void saveFailure_keepsSnapshots() {
    Instant t0 = Instant.parse("2026-11-09T00:00:00Z");
    usage.saveSuccess(account, List.of(snap(UsageWindow.FIVE_HOUR, "10.00", t0)), false);
    // 앞선 성공이 하루 전이었던 것처럼 돌린다(테스트 트랜잭션 안에서는 now() 가 고정이라)
    dsl.execute(
        "UPDATE agent_account_usage_check SET succeeded_at = now() - interval '1 day'"
            + " WHERE account_id = ?",
        account);
    usage.saveFailure(account, "NETWORK", "연결 실패");

    assertThat(usage.findSnapshots(List.of(account)).get(account)).hasSize(1);
    UsageCheckRow check = usage.findChecks(List.of(account)).get(account);
    assertThat(check.succeededAt()).isBefore(check.checkedAt());
    assertThat(check.errorCode()).isEqualTo("NETWORK");
    assertThat(check.errorMessage()).isEqualTo("연결 실패");
  }

  @Test
  void touchLastUsed_skipsWithinOneMinute() {
    Instant t0 = Instant.parse("2026-11-09T00:00:00Z");
    assertThat(usage.touchLastUsed(List.of(agent), t0)).isEqualTo(1);
    // 30초 뒤 — 1분 이내라 건너뛴다.
    assertThat(usage.touchLastUsed(List.of(agent), t0.plusSeconds(30))).isZero();
    assertThat(usage.findChecks(List.of(account)).get(account).lastUsedAt()).isEqualTo(t0);
    // 2분 뒤 — 갱신된다.
    assertThat(usage.touchLastUsed(List.of(agent), t0.plusSeconds(120))).isEqualTo(1);
    assertThat(usage.findChecks(List.of(account)).get(account).lastUsedAt())
        .isEqualTo(t0.plusSeconds(120));
  }

  @Test
  void rlsIsolatesTenants() {
    Instant t0 = Instant.parse("2026-11-09T00:00:00Z");
    usage.saveSuccess(account, List.of(snap(UsageWindow.FIVE_HOUR, "10.00", t0)), false);
    long tenant2 = TestFixtures.createTenant(dsl, "ACTIVE");

    useTenant(tenant2);
    assertThat(usage.findSnapshots(List.of(account))).isEmpty();
    assertThat(usage.findChecks(List.of(account))).isEmpty();

    useTenant(1L);
    assertThat(usage.findSnapshots(List.of(account))).containsKey(account);
  }
}
