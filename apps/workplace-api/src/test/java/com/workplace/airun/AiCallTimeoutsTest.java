package com.workplace.airun;

import static com.workplace.airun.AiCall.*;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.workplace.airun.context.AiRunKinds;
import java.time.Duration;
import java.util.Arrays;
import java.util.List;
import java.util.Set;
import java.util.stream.Collectors;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;

/** AiCall 표·AiCallTimeouts 덮어쓰기 검증(순수 단위 테스트). */
class AiCallTimeoutsTest {

  @Test
  void defaultsMatchTable() {
    AiCallTimeouts t = AiCallTimeouts.defaults();
    assertThat(t.timeoutMs(HOME_PRIORITY_CLASSIFY)).isEqualTo(120_000);
    assertThat(t.timeoutMs(WORK_PROFILE)).isEqualTo(180_000);
    assertThat(t.timeoutMs(AI_CHAT)).isEqualTo(180_000);
    assertThat(t.timeoutMs(HOME_SUGGESTIONS_STARTER)).isEqualTo(15_000);
    assertThat(t.timeoutMs(HOME_SHARED_MEMORY_CHECK_REQUEST)).isEqualTo(12_000);
    assertThat(t.timeoutMs(MAIL_REPLY_DRAFT)).isEqualTo(60_000);
  }

  @Test
  void everyKindIsKnown() {
    Set<String> routeKinds = Set.copyOf(AiRunKinds.routeKinds().values());
    Set<String> callKinds =
        Arrays.stream(AiCall.values()).map(AiCall::kind).collect(Collectors.toSet());
    assertThat(routeKinds).containsAll(callKinds);
    assertThat(callKinds).containsAll(routeKinds);
  }

  @Test
  void backgroundCallsAtLeast60s() {
    List<AiCall> sync =
        List.of(
            HOME_SUGGESTIONS_STARTER,
            HOME_SUGGESTIONS_FOLLOWUP,
            HOME_SUGGESTIONS_QUESTION_OPTIONS,
            HOME_SHARED_MEMORY_CHECK_REQUEST);
    for (AiCall c : AiCall.values()) {
      if (!sync.contains(c)) {
        assertThat(c.defaultTimeout()).as(c.name()).isGreaterThanOrEqualTo(Duration.ofSeconds(60));
      }
    }
  }

  @Test
  void overrideApplies() {
    AiCallTimeouts t =
        new AiCallTimeouts(" HOME_PRIORITY_CLASSIFY=90s , WORK_PROFILE=3m,MAIL_REPLY_DRAFT=PT2M ");
    assertThat(t.timeoutMs(HOME_PRIORITY_CLASSIFY)).isEqualTo(90_000);
    assertThat(t.timeoutMs(WORK_PROFILE)).isEqualTo(180_000);
    assertThat(t.timeoutMs(MAIL_REPLY_DRAFT)).isEqualTo(120_000);
    assertThat(t.timeoutMs(AI_CHAT)).isEqualTo(180_000);
    assertThat(t.timeoutMs(MAIL_ANALYZE_CONTENT)).isEqualTo(120_000);
  }

  @Test
  void blankMeansNoOverride() {
    for (String v : new String[] {"", "   ", null}) {
      AiCallTimeouts t = new AiCallTimeouts(v);
      for (AiCall c : AiCall.values()) {
        assertThat(t.timeout(c)).as(c.name()).isEqualTo(c.defaultTimeout());
      }
    }
  }

  @ParameterizedTest
  @ValueSource(
      strings = {
        "NOPE=90s",
        "WORK_PROFILE",
        "WORK_PROFILE=abc",
        "WORK_PROFILE=0s",
        "WORK_PROFILE=31m",
        "WORK_PROFILE=9m",
        "AI_CHAT=5m",
        "WORK_PROFILE=90s,WORK_PROFILE=100s"
      })
  void rejectsBadOverrides(String overrides) {
    String name =
        overrides.startsWith("NOPE")
            ? "NOPE"
            : overrides.startsWith("AI_CHAT") ? "AI_CHAT" : "WORK_PROFILE";
    assertThatThrownBy(() -> new AiCallTimeouts(overrides))
        .isInstanceOf(IllegalStateException.class)
        .hasMessageContaining(name);
  }

  @Test
  void rejectsOverAgentLimit() {
    assertThatThrownBy(() -> new AiCallTimeouts("HOME_MEMORY_CLEANUP=61s"))
        .isInstanceOf(IllegalStateException.class)
        .hasMessageContaining("HOME_MEMORY_CLEANUP")
        .hasMessageContaining("60");
    assertThatThrownBy(() -> new AiCallTimeouts("DRIVE_SECURITY_CHECK=9m"))
        .isInstanceOf(IllegalStateException.class)
        .hasMessageContaining("DRIVE_SECURITY_CHECK");
  }

  @Test
  void readTimeoutIsMaxPlusMargin() {
    assertThat(AiCallTimeouts.defaults().readTimeoutFor(MAIL_REPLY_DRAFT, MAIL_ANALYZE_CONTENT))
        .isEqualTo(Duration.ofSeconds(150));
    assertThat(
            new AiCallTimeouts("MAIL_REPLY_DRAFT=5m")
                .readTimeoutFor(MAIL_REPLY_DRAFT, MAIL_ANALYZE_CONTENT))
        .isEqualTo(Duration.ofSeconds(330));
  }

  @Test
  void 하한과_표_읽기_상한_중_큰_값을_쓴다() {
    AiCallTimeouts t = AiCallTimeouts.defaults();
    // 표 값(60+30=90초)이 하한 120초보다 작으면 하한, 크면 표 값.
    assertThat(t.readTimeoutAtLeast(Duration.ofSeconds(120), MAIL_REPLY_DRAFT))
        .isEqualTo(Duration.ofSeconds(120));
    assertThat(t.readTimeoutAtLeast(Duration.ofSeconds(60), MAIL_ANALYZE_CONTENT))
        .isEqualTo(Duration.ofSeconds(150));
  }

  /** WP-2111: 덮어쓰기 최대는 그 호출을 돌리는 가장 짧은 소비자보다 짧다 — 값 옆 주석의 소비자 값을 리터럴로 고정해 둘이 어긋나면 깨진다. */
  @Test
  void 덮어쓰기_최대에_읽기_여유를_더해도_소비자보다_짧다() {
    Duration margin = AiCallTimeouts.READ_MARGIN;
    // WorkProfileService.STALE_PENDING 10분
    assertThat(WORK_PROFILE.maxOverride().plus(margin)).isLessThan(Duration.ofMinutes(10));
    // WorkerJobRepository.SUMMARY_LEASE_DURATION 10분(요약·보안 검사 리스)
    assertThat(DRIVE_SUMMARIZE.maxOverride().plus(margin)).isLessThan(Duration.ofMinutes(10));
    assertThat(DRIVE_SECURITY_CHECK.maxOverride().plus(margin)).isLessThan(Duration.ofMinutes(10));
    // 리포트 예약 STALE_PENDING_MINUTES 30분·잠금 40분
    assertThat(PROJECT_REPORT.maxOverride().plus(margin)).isLessThan(Duration.ofMinutes(30));
    assertThat(PERSONAL_REPORT.maxOverride().plus(margin)).isLessThan(Duration.ofMinutes(30));
    // 특별한 소비자가 없는 항목은 10분 — 기본 잠금 30분 − 여유 안에 한 호출이 끝난다
    for (AiCall c : AiCall.values()) {
      assertThat(c.maxOverride().plus(margin))
          .as(c.name())
          .isLessThan(Duration.ofMinutes(30).minus(RoundDeadline.LOCK_MARGIN));
    }
  }

  @Test
  void 리포트_항목은_20분까지_덮어쓰고_그_밖의_백그라운드는_10분까지다() {
    assertThat(new AiCallTimeouts("PROJECT_REPORT=20m").timeout(PROJECT_REPORT))
        .isEqualTo(Duration.ofMinutes(20));
    assertThatThrownBy(() -> new AiCallTimeouts("PROJECT_REPORT=21m"))
        .isInstanceOf(IllegalStateException.class)
        .hasMessageContaining("PROJECT_REPORT");
    assertThat(new AiCallTimeouts("MAIL_REPLY_DRAFT=10m").timeout(MAIL_REPLY_DRAFT))
        .isEqualTo(Duration.ofMinutes(10));
    assertThatThrownBy(() -> new AiCallTimeouts("MAIL_REPLY_DRAFT=11m"))
        .isInstanceOf(IllegalStateException.class)
        .hasMessageContaining("MAIL_REPLY_DRAFT");
  }

  @Test
  void 지정한_여유로_읽기_상한을_계산한다() {
    AiCallTimeouts t = AiCallTimeouts.defaults();
    assertThat(t.readTimeoutWithMargin(Duration.ofSeconds(3), HOME_SHARED_MEMORY_CHECK_REQUEST))
        .isEqualTo(Duration.ofSeconds(15));
    assertThat(
            t.readTimeoutWithMargin(
                Duration.ofSeconds(5), HOME_SUGGESTIONS_STARTER, HOME_SUGGESTIONS_FOLLOWUP))
        .isEqualTo(Duration.ofSeconds(25));
    assertThat(
            new AiCallTimeouts("HOME_SUGGESTIONS_FOLLOWUP=40s")
                .readTimeoutWithMargin(Duration.ofSeconds(5), HOME_SUGGESTIONS_FOLLOWUP))
        .isEqualTo(Duration.ofSeconds(45));
  }

  @Test
  void 회차_마감은_잠금에서_여유를_뺀_시각이고_최악이_넘으면_막는다() {
    java.time.Instant start = java.time.Instant.parse("2026-11-25T00:00:00Z");
    RoundDeadline d =
        RoundDeadline.underLock(
            java.time.Clock.fixed(start, java.time.ZoneOffset.UTC), Duration.ofMinutes(30));
    assertThat(d.remaining()).isEqualTo(Duration.ofMinutes(28));
    assertThat(d.allows(Duration.ofMinutes(28))).isTrue();
    assertThat(d.allows(Duration.ofMinutes(28).plusSeconds(1))).isFalse();
    assertThat(RoundDeadline.unlimited().allows(Duration.ofDays(1))).isTrue();
  }
}
