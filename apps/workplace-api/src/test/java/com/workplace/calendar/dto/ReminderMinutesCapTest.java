package com.workplace.calendar.dto;

import static org.assertj.core.api.Assertions.assertThat;

import jakarta.validation.Validation;
import jakarta.validation.Validator;
import java.time.OffsetDateTime;
import java.util.List;
import org.junit.jupiter.api.Test;

/** WP-799: 리마인더는 일정 4주 전(40320분)까지 — 넘으면 400, 앱 선택지(10·60·1440분)와 4주는 통과. */
class ReminderMinutesCapTest {

  private static final Validator VALIDATOR =
      Validation.buildDefaultValidatorFactory().getValidator();

  private static CalendarEventRequest withReminder(Integer minutes) {
    OffsetDateTime start = OffsetDateTime.parse("2026-11-01T01:00:00Z");
    return new CalendarEventRequest(
        "회의", null, start, start.plusHours(1), false, null, null, minutes, null, List.of(), null);
  }

  @Test
  void overFourWeeks_rejected() {
    assertThat(VALIDATOR.validate(withReminder(40321))).isNotEmpty();
    assertThat(VALIDATOR.validate(withReminder(Integer.MAX_VALUE))).isNotEmpty();
  }

  @Test
  void upToFourWeeks_allowed() {
    for (Integer m : new Integer[] {null, 0, 10, 60, 1440, 40320}) {
      assertThat(VALIDATOR.validate(withReminder(m))).as(String.valueOf(m)).isEmpty();
    }
  }
}
