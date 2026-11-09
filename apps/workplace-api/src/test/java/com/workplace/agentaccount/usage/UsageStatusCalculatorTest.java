package com.workplace.agentaccount.usage;

import static org.assertj.core.api.Assertions.assertThat;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;
import org.junit.jupiter.api.Test;

/**
 * WP-1449 사용량 상태 계산 — 임박·도달 경계값, provider 한도 도달 알림, 마지막 실패, 다시 로그인 우선, 조회하지 않는 종류, 기록 없음, 임박 기준
 * 설정값, 초기화 시각이 지난 창 제외를 본다. 순수 계산이라 DB 없이 돈다.
 */
class UsageStatusCalculatorTest {

  private static final Instant T = Instant.parse("2026-11-09T00:00:00Z");
  private static final BigDecimal NEAR = BigDecimal.valueOf(75);

  /** 5시간 창 하나만 둔 스냅샷. */
  private static List<UsageSnapshot> five(String percent) {
    return List.of(new UsageSnapshot(UsageWindow.FIVE_HOUR, new BigDecimal(percent), T, null, T));
  }

  /** 마지막 시도가 성공한 기록. */
  private static UsageCheckRow ok(boolean limitReached) {
    return new UsageCheckRow(T, T, limitReached, null, null, null);
  }

  private static String claude(List<UsageSnapshot> s, UsageCheckRow c) {
    return UsageStatusCalculator.status("anthropic", "ACTIVE", s, c, NEAR, T);
  }

  @Test
  void boundaries() {
    assertThat(claude(five("74.99"), ok(false))).isEqualTo("OK");
    assertThat(claude(five("75.00"), ok(false))).isEqualTo("NEAR_LIMIT");
    assertThat(claude(five("99.99"), ok(false))).isEqualTo("NEAR_LIMIT");
    assertThat(claude(five("100.00"), ok(false))).isEqualTo("LIMIT_REACHED");
  }

  @Test
  void weeklyWindowAlsoCounts() {
    List<UsageSnapshot> s =
        List.of(
            new UsageSnapshot(UsageWindow.FIVE_HOUR, new BigDecimal("10.00"), T, null, T),
            new UsageSnapshot(UsageWindow.WEEKLY, new BigDecimal("80.00"), T, null, T));
    assertThat(claude(s, ok(false))).isEqualTo("NEAR_LIMIT");
  }

  @Test
  void providerLimitReachedWinsOverLowUsage() {
    assertThat(claude(five("5.00"), ok(true))).isEqualTo("LIMIT_REACHED");
    List<UsageSnapshot> rejected =
        List.of(new UsageSnapshot(UsageWindow.WEEKLY, new BigDecimal("5.00"), T, "rejected", T));
    assertThat(claude(rejected, ok(false))).isEqualTo("LIMIT_REACHED");
  }

  @Test
  void lastAttemptFailedIsCheckFailedEvenWithEarlierSuccess() {
    UsageCheckRow failed =
        new UsageCheckRow(T, T.minusSeconds(600), false, "TOKEN_EXPIRED", "토큰 만료", null);
    assertThat(claude(five("100.00"), failed)).isEqualTo("CHECK_FAILED");
    UsageCheckRow neverSucceeded = new UsageCheckRow(T, null, false, "NETWORK", "연결 실패", null);
    assertThat(claude(List.of(), neverSucceeded)).isEqualTo("CHECK_FAILED");
  }

  @Test
  void reloginRequiredComesFirst() {
    UsageCheckRow failed = new UsageCheckRow(T, null, false, "UNAUTHORIZED", "인증 실패", null);
    assertThat(
            UsageStatusCalculator.status(
                "chatgpt", "RELOGIN_REQUIRED", five("100.00"), failed, NEAR, T))
        .isEqualTo("RELOGIN_REQUIRED");
    assertThat(UsageStatusCalculator.status("genia", "RELOGIN_REQUIRED", null, null, NEAR, T))
        .isEqualTo("RELOGIN_REQUIRED");
  }

  @Test
  void geniaAndOpencodeAreUnlimited() {
    assertThat(UsageStatusCalculator.status("genia", "ACTIVE", null, null, NEAR, T))
        .isEqualTo("UNLIMITED");
    assertThat(UsageStatusCalculator.status("opencode", "ACTIVE", null, null, NEAR, T))
        .isEqualTo("UNLIMITED");
  }

  @Test
  void noRecordIsUnknown() {
    assertThat(claude(List.of(), null)).isEqualTo("UNKNOWN");
    // 마지막 사용 시각만 쓰인 행(시도 시각 없음)도 아직 시도하지 않은 것이다
    UsageCheckRow touchedOnly = new UsageCheckRow(null, null, false, null, null, T);
    assertThat(claude(null, touchedOnly)).isEqualTo("UNKNOWN");
  }

  @Test
  void windowsAlreadyResetDoNotCount() {
    // 1시간 전에 초기화된 100% 5시간 창 + 지난 rejected 주간 창 — 둘 다 지금은 풀렸으므로 판정에서 빠진다
    Instant past = T.minusSeconds(3600);
    List<UsageSnapshot> stale =
        List.of(
            new UsageSnapshot(UsageWindow.FIVE_HOUR, new BigDecimal("100.00"), past, null, past),
            new UsageSnapshot(UsageWindow.WEEKLY, new BigDecimal("90.00"), past, "rejected", past));
    assertThat(claude(stale, ok(false))).isEqualTo("OK");
    // 지난 창은 빠지고 아직 유효한 창(80%)만 보아 임박
    List<UsageSnapshot> mixed =
        List.of(
            new UsageSnapshot(UsageWindow.FIVE_HOUR, new BigDecimal("100.00"), past, null, past),
            new UsageSnapshot(
                UsageWindow.WEEKLY, new BigDecimal("80.00"), T.plusSeconds(3600), null, past));
    assertThat(claude(mixed, ok(false))).isEqualTo("NEAR_LIMIT");
    // 초기화 시각을 모르는 창(null)은 그대로 센다
    List<UsageSnapshot> noReset =
        List.of(new UsageSnapshot(UsageWindow.FIVE_HOUR, new BigDecimal("100.00"), null, null, T));
    assertThat(claude(noReset, ok(false))).isEqualTo("LIMIT_REACHED");
  }

  @Test
  void nearLimitFollowsSetting() {
    assertThat(
            UsageStatusCalculator.status(
                "anthropic", "ACTIVE", five("75.00"), ok(false), BigDecimal.valueOf(80), T))
        .isEqualTo("OK");
  }
}
