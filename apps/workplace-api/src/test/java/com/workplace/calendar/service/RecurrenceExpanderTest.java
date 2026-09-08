package com.workplace.calendar.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.time.OffsetDateTime;
import java.util.List;
import java.util.Set;
import org.junit.jupiter.api.Test;

/** RRULE 회차 전개 순수 단위 테스트(DB 무관). fastForward 회귀 가드 포함. */
class RecurrenceExpanderTest {
  private final RecurrenceExpander expander = new RecurrenceExpander();

  /** 과거에 시작한 일간 마스터도 조회 범위 내 회차만 반환해야 한다(fastForward 회귀 가드). */
  @Test
  void expand_pastDailyMaster_returnsOnlyInRangeOccurrences() {
    var start = OffsetDateTime.parse("2024-01-01T09:00:00Z");
    List<OffsetDateTime> occ =
        expander.expand(
            "FREQ=DAILY",
            start,
            OffsetDateTime.parse("2026-06-08T00:00:00Z"),
            OffsetDateTime.parse("2026-06-15T00:00:00Z"));
    assertThat(occ).hasSize(7);
    assertThat(occ.get(0)).isEqualTo(OffsetDateTime.parse("2026-06-08T09:00:00Z"));
  }

  /** COUNT 제한 — 4회만. */
  @Test
  void expand_weekly_count() {
    List<OffsetDateTime> occ =
        expander.expand(
            "FREQ=WEEKLY;COUNT=4",
            OffsetDateTime.parse("2026-06-01T09:00:00Z"),
            OffsetDateTime.parse("2026-06-01T00:00:00Z"),
            OffsetDateTime.parse("2026-12-31T00:00:00Z"));
    assertThat(occ).hasSize(4);
  }

  /** UNTIL 경계 포함 — 6/1,6/2,6/3 → 3회. */
  @Test
  void expand_until_boundary() {
    List<OffsetDateTime> occ =
        expander.expand(
            "FREQ=DAILY;UNTIL=20260603T090000Z",
            OffsetDateTime.parse("2026-06-01T09:00:00Z"),
            OffsetDateTime.parse("2026-06-01T00:00:00Z"),
            OffsetDateTime.parse("2026-12-31T00:00:00Z"));
    assertThat(occ).hasSize(3);
  }

  /** 잘못된 RRULE 은 IllegalArgumentException(전역 핸들러에서 400) 으로 전환되어야 한다. */
  @Test
  void validate_invalidRule_throws() {
    assertThatThrownBy(() -> expander.validate("GARBAGE"))
        .isInstanceOf(IllegalArgumentException.class);
  }

  /** withUntil — COUNT 토큰을 제거하고 UNTIL 로 교체(상호 배타)하며 UTC 절대 시각으로 포맷한다. */
  @Test
  void withUntil_replacesCount() {
    String r =
        RecurrenceExpander.withUntil(
            "FREQ=WEEKLY;COUNT=10", OffsetDateTime.parse("2026-06-17T08:59:59Z"));
    assertThat(r).isEqualTo("FREQ=WEEKLY;UNTIL=20260617T085959Z");
  }

  /** withUntil — 기존 UNTIL 토큰도 새 값으로 교체한다. */
  @Test
  void withUntil_replacesExistingUntil() {
    String r =
        RecurrenceExpander.withUntil(
            "FREQ=DAILY;UNTIL=20260101T000000Z", OffsetDateTime.parse("2026-06-17T08:59:59Z"));
    assertThat(r).isEqualTo("FREQ=DAILY;UNTIL=20260617T085959Z");
  }

  /** withUntil — UNTIL/COUNT 이 없는 규칙엔 UNTIL 을 덧붙인다. 비-UTC 오프셋도 UTC 절대 시각으로 변환. */
  @Test
  void withUntil_appendsAndConvertsToUtc() {
    String r =
        RecurrenceExpander.withUntil(
            "FREQ=WEEKLY", OffsetDateTime.parse("2026-06-17T17:59:59+09:00"));
    assertThat(r).isEqualTo("FREQ=WEEKLY;UNTIL=20260617T085959Z");
  }

  /** expand 도 잘못된 규칙이면 동일하게 IllegalArgumentException(list per-master 격리 대상). */
  @Test
  void expand_invalidRule_throws() {
    assertThatThrownBy(
            () ->
                expander.expand(
                    "GARBAGE",
                    OffsetDateTime.parse("2026-06-01T09:00:00Z"),
                    OffsetDateTime.parse("2026-06-01T00:00:00Z"),
                    OffsetDateTime.parse("2026-12-31T00:00:00Z")))
        .isInstanceOf(IllegalArgumentException.class);
  }

  // ── nextOccurrenceAfter(#705 — 캘린더 리마인더 회차별 재무장) ──────────────────────────────

  /** after 직후 다음 주간 회차를 찾는다(제외 없음). */
  @Test
  void nextOccurrenceAfter_weekly_returnsNextOccurrence() {
    var master = OffsetDateTime.parse("2026-06-01T09:00:00Z"); // 월요일
    var after = OffsetDateTime.parse("2026-06-01T09:00:00Z"); // 1회차 시작 시각 그 자체

    var next = expander.nextOccurrenceAfter("FREQ=WEEKLY", master, after, Set.of());

    assertThat(next).contains(OffsetDateTime.parse("2026-06-08T09:00:00Z"));
  }

  /** 예외(취소/오버라이드) 회차는 건너뛰고 그 다음 회차를 반환한다. */
  @Test
  void nextOccurrenceAfter_skipsExcludedOccurrence() {
    var master = OffsetDateTime.parse("2026-06-01T09:00:00Z");
    var after = OffsetDateTime.parse("2026-06-01T09:00:00Z");
    var cancelled = OffsetDateTime.parse("2026-06-08T09:00:00Z").toInstant();

    var next = expander.nextOccurrenceAfter("FREQ=WEEKLY", master, after, Set.of(cancelled));

    assertThat(next).contains(OffsetDateTime.parse("2026-06-15T09:00:00Z"));
  }

  /** COUNT 로 시리즈가 이미 끝났으면(더 이상 미제외 회차 없음) empty. */
  @Test
  void nextOccurrenceAfter_seriesEnded_returnsEmpty() {
    var master = OffsetDateTime.parse("2026-06-01T09:00:00Z");
    var after = OffsetDateTime.parse("2026-06-08T09:00:00Z"); // 이미 2회차(COUNT=2) 이후

    var next = expander.nextOccurrenceAfter("FREQ=WEEKLY;COUNT=2", master, after, Set.of());

    assertThat(next).isEmpty();
  }
}
