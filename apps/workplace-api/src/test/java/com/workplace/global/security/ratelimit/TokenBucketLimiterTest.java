package com.workplace.global.security.ratelimit;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneId;
import java.time.ZoneOffset;
import org.junit.jupiter.api.Test;

/** 메모리 토큰 버킷(WP-763) — 1분에 capacity 회까지 받고, 그 뒤 고르게 다시 찬다. */
class TokenBucketLimiterTest {

  /** 테스트가 시각을 앞으로 옮기는 시계. */
  private static final class MovableClock extends Clock {
    private Instant now = Instant.parse("2026-10-24T00:00:00Z");

    void advance(Duration d) {
      now = now.plus(d);
    }

    @Override
    public ZoneId getZone() {
      return ZoneOffset.UTC;
    }

    @Override
    public Clock withZone(ZoneId zone) {
      return this;
    }

    @Override
    public Instant instant() {
      return now;
    }
  }

  @Test
  void capacity_만큼_받고_넘치면_다시_시도할_초를_돌려준다() {
    MovableClock clock = new MovableClock();
    TokenBucketLimiter limiter = new TokenBucketLimiter(clock);
    for (int i = 0; i < 20; i++) assertThat(limiter.tryConsume("LOGIN:1.2.3.4", 20)).isZero();
    // 1분에 20개 → 토큰 하나가 차는 데 3초
    assertThat(limiter.tryConsume("LOGIN:1.2.3.4", 20)).isEqualTo(3);
    // 다른 키는 따로 센다
    assertThat(limiter.tryConsume("LOGIN:5.6.7.8", 20)).isZero();
  }

  @Test
  void 시간이_지나면_비율만큼_다시_찬다() {
    MovableClock clock = new MovableClock();
    TokenBucketLimiter limiter = new TokenBucketLimiter(clock);
    for (int i = 0; i < 10; i++) limiter.tryConsume("SHARE_PASSWORD:1.2.3.4", 10);
    assertThat(limiter.tryConsume("SHARE_PASSWORD:1.2.3.4", 10)).isPositive();
    clock.advance(Duration.ofSeconds(6)); // 10개/분 → 6초에 하나
    assertThat(limiter.tryConsume("SHARE_PASSWORD:1.2.3.4", 10)).isZero();
    assertThat(limiter.tryConsume("SHARE_PASSWORD:1.2.3.4", 10)).isPositive();
    clock.advance(Duration.ofMinutes(5)); // 오래 쉬어도 capacity 를 넘게 쌓이지 않는다
    for (int i = 0; i < 10; i++)
      assertThat(limiter.tryConsume("SHARE_PASSWORD:1.2.3.4", 10)).isZero();
    assertThat(limiter.tryConsume("SHARE_PASSWORD:1.2.3.4", 10)).isPositive();
  }

  @Test
  void 키가_많아지면_다_찬_버킷을_쓸어낸다() {
    MovableClock clock = new MovableClock();
    TokenBucketLimiter limiter = new TokenBucketLimiter(clock);
    for (int i = 0; i <= TokenBucketLimiter.SWEEP_THRESHOLD; i++)
      limiter.tryConsume("LOGIN:ip" + i, 20);
    clock.advance(Duration.ofMinutes(1)); // 모두 다시 가득 참
    limiter.tryConsume("LOGIN:new", 20);
    assertThat(limiter.size()).isEqualTo(1);
  }
}
