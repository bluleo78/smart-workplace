package com.workplace.calendar.service;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.OffsetDateTime;
import java.util.List;
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
}
