package com.workplace.messaging.service;

import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.global.ai.AiMemoryLine;
import com.workplace.messaging.outbound.dto.CatchupSummarizeResult;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.List;
import org.junit.jupiter.api.Test;

class CatchupSummaryCacheTest {
  /** 메모리 없음(빈 목록) — 메모리와 무관한 키 동작을 볼 때 쓴다. */
  private static final List<AiMemoryLine> NONE = List.of();

  private static CatchupSummarizeResult sample() {
    return new CatchupSummarizeResult(List.of(), List.of());
  }

  @Test
  void 같은_키는_히트() {
    var cache = new CatchupSummaryCache(Clock.systemUTC());
    cache.put(NONE, 1L, 10L, 20L, sample());
    assertThat(cache.get(NONE, 1L, 10L, 20L)).isNotNull();
  }

  @Test
  void maxMessageId_가_다르면_미스() {
    var cache = new CatchupSummaryCache(Clock.systemUTC());
    cache.put(NONE, 1L, 10L, 20L, sample());
    assertThat(cache.get(NONE, 1L, 10L, 21L)).isNull(); // 새 메시지 도착 → 재계산
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
    cache.put(NONE, 1L, 10L, 20L, sample());
    mutable.set(base.plus(Duration.ofMinutes(11)));
    assertThat(cache.get(NONE, 1L, 10L, 20L)).isNull();
  }

  /** 키는 실린 메모리의 지문이다 — 내용이 다르면 미스, 같은 내용(새로 만든 목록이어도)이면 히트. */
  @Test
  void 메모리가_다르면_미스_같으면_히트() {
    var cache = new CatchupSummaryCache(Clock.systemUTC());
    cache.put(List.of(line(1, "요약은 세 줄로", null)), 1L, 10L, 20L, sample());
    assertThat(cache.get(List.of(line(1, "요약은 다섯 줄로", null)), 1L, 10L, 20L)).isNull();
    assertThat(cache.get(NONE, 1L, 10L, 20L)).isNull();
    assertThat(cache.get(List.of(line(1, "요약은 세 줄로", null)), 1L, 10L, 20L)).isNotNull();
  }

  /** 빈 목록(메모리 없음·꺼짐)은 고정 지문이라 서로 같고, 메모리가 있는 목록과는 다르다. */
  @Test
  void 메모리가_없으면_고정_지문이다() {
    assertThat(CatchupSummaryCache.fingerprint(List.of()))
        .isEqualTo(CatchupSummaryCache.fingerprint(null))
        .isNotEqualTo(CatchupSummaryCache.fingerprint(List.of(line(1, "a", null))));
  }

  /** 필드 경계·null 이 섞이지 않는다 — 이어 붙이면 같은 글자가 되는 두 목록, null 과 빈 문자열은 지문이 다르다. */
  @Test
  void 필드_경계와_null_이_다르면_지문도_다르다() {
    assertThat(CatchupSummaryCache.fingerprint(List.of(line(1, "ab", "c"))))
        .isNotEqualTo(CatchupSummaryCache.fingerprint(List.of(line(1, "a", "bc"))));
    assertThat(CatchupSummaryCache.fingerprint(List.of(line(1, "a", null))))
        .isNotEqualTo(CatchupSummaryCache.fingerprint(List.of(line(1, "a", ""))));
    assertThat(CatchupSummaryCache.fingerprint(List.of(line(1, "a", null))))
        .isNotEqualTo(CatchupSummaryCache.fingerprint(List.of(line(2, "a", null))));
  }

  /** 메모리 한 줄 — content·scope 만 바꿔 가며 쓴다(종류 PREFERENCE, 기한 없음). */
  private static AiMemoryLine line(long id, String content, String scope) {
    return new AiMemoryLine(id, "PREFERENCE", content, scope, null);
  }

  /** WP-383: 고정 여부도 지문에 든다 — 같은 내용이어도 고정이 바뀌면 블록 줄("·고정")이 달라 요약을 따로 만든다. */
  @Test
  void 고정이_다르면_지문도_다르다() {
    assertThat(
            CatchupSummaryCache.fingerprint(
                List.of(new AiMemoryLine(1, "PREFERENCE", "a", null, null, true))))
        .isNotEqualTo(
            CatchupSummaryCache.fingerprint(
                List.of(new AiMemoryLine(1, "PREFERENCE", "a", null, null))));
  }
}
