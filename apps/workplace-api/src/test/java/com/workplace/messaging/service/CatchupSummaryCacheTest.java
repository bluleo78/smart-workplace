package com.workplace.messaging.service;

import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.messaging.outbound.dto.CatchupSummarizeResult;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.List;
import org.junit.jupiter.api.Test;

class CatchupSummaryCacheTest {
  private static CatchupSummarizeResult sample() {
    return new CatchupSummarizeResult(List.of(), List.of());
  }

  @Test
  void 같은_키는_히트() {
    var cache = new CatchupSummaryCache(Clock.systemUTC());
    cache.put(1L, 10L, 20L, sample());
    assertThat(cache.get(1L, 10L, 20L)).isNotNull();
  }

  @Test
  void maxMessageId_가_다르면_미스() {
    var cache = new CatchupSummaryCache(Clock.systemUTC());
    cache.put(1L, 10L, 20L, sample());
    assertThat(cache.get(1L, 10L, 21L)).isNull(); // 새 메시지 도착 → 재계산
  }

  @Test
  void TTL_경과_시_만료() {
    var base = Instant.parse("2026-06-24T00:00:00Z");
    var mutable = new java.util.concurrent.atomic.AtomicReference<>(base);
    Clock clock =
        new Clock() {
          public ZoneOffset getZone() {
            return ZoneOffset.UTC;
          }

          public Clock withZone(java.time.ZoneId z) {
            return this;
          }

          public Instant instant() {
            return mutable.get();
          }
        };
    var cache = new CatchupSummaryCache(clock);
    cache.put(1L, 10L, 20L, sample());
    mutable.set(base.plus(Duration.ofMinutes(11)));
    assertThat(cache.get(1L, 10L, 20L)).isNull();
  }
}
