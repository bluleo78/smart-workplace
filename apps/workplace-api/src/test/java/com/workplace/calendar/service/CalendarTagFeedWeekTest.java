package com.workplace.calendar.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.time.LocalDate;
import java.time.OffsetDateTime;
import org.junit.jupiter.api.Test;

/**
 * 태그 구독 주소의 ?week=·종일 날짜 해석 단위 테스트 — IcsWriter 를 global/ical 로 옮기며(WP-986) IcsWriterTest 에서 떼어 냈다.
 */
class CalendarTagFeedWeekTest {

  /** ?week= — ISO 주의 월요일. 없으면 오늘이 든 주, 형식 오류·그 해에 없는 주는 400 사유. */
  @Test
  void weekStart_parsesIsoWeek() {
    LocalDate today = LocalDate.of(2026, 10, 22); // 목요일
    assertThat(CalendarTagFeedService.weekStart("2026-W43", today))
        .isEqualTo(LocalDate.of(2026, 10, 19));
    assertThat(CalendarTagFeedService.weekStart(null, today)).isEqualTo(LocalDate.of(2026, 10, 19));
    assertThat(CalendarTagFeedService.weekStart("", today)).isEqualTo(LocalDate.of(2026, 10, 19));
    // 연도 경계 — 2026-W01 은 2025-12-29(월)에 시작한다
    assertThat(CalendarTagFeedService.weekStart("2026-W01", today))
        .isEqualTo(LocalDate.of(2025, 12, 29));
    // 53주가 있는 해(2026)와 없는 해(2025)
    assertThat(CalendarTagFeedService.weekStart("2026-W53", today))
        .isEqualTo(LocalDate.of(2026, 12, 28));
    assertThatThrownBy(() -> CalendarTagFeedService.weekStart("2025-W53", today))
        .isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(() -> CalendarTagFeedService.weekStart("2026-W00", today))
        .isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(() -> CalendarTagFeedService.weekStart("2026-43", today))
        .isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(() -> CalendarTagFeedService.weekStart("2026-W4", today))
        .isInstanceOf(IllegalArgumentException.class);
  }

  /** 종일 날짜 — 앱 종일(한국 자정 = 전날 15:00Z)과 M365 종일(UTC 자정)이 모두 의도한 날짜가 된다. */
  @Test
  void allDayDate_handlesKstAndUtcMidnight() {
    assertThat(CalendarTagFeedService.allDayDate(OffsetDateTime.parse("2026-10-21T15:00:00Z")))
        .isEqualTo(LocalDate.of(2026, 10, 22));
    assertThat(CalendarTagFeedService.allDayDate(OffsetDateTime.parse("2026-10-23T00:00:00Z")))
        .isEqualTo(LocalDate.of(2026, 10, 23));
  }
}
