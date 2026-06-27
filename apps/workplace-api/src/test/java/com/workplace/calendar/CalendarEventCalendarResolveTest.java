package com.workplace.calendar;

import static com.workplace.jooq.Tables.USER;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.workplace.calendar.dto.CalendarEventRequest;
import com.workplace.calendar.dto.CalendarResponse;
import com.workplace.calendar.exception.CalendarNotFoundException;
import com.workplace.calendar.service.CalendarEventService;
import com.workplace.calendar.service.CalendarService;
import com.workplace.support.IntegrationTestBase;
import java.time.OffsetDateTime;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.annotation.Transactional;

@Transactional
class CalendarEventCalendarResolveTest extends IntegrationTestBase {
  @Autowired DSLContext dsl;
  @Autowired CalendarEventService events;
  @Autowired CalendarService calendars;

  private static final OffsetDateTime S = OffsetDateTime.parse("2026-06-10T09:00:00Z");

  private long user() {
    String t = UUID.randomUUID().toString().replace("-", "").substring(0, 8);
    return dsl.insertInto(USER)
        .set(USER.USERNAME, "er_" + t)
        .set(USER.PASSWORD, "pw")
        .set(USER.NAME, "U " + t)
        .set(USER.EMAIL, t + "@example.com")
        .set(USER.KIND, "HUMAN")
        .returning(USER.ID)
        .fetchOne()
        .getId();
  }

  private CalendarEventRequest req(Long calendarId, String color) {
    return new CalendarEventRequest(
        "회의", null, S, S.plusHours(1), false, null, color, null, null, null, calendarId);
  }

  @Test
  void create_without_calendarId_resolves_to_default() {
    long u = user();
    var created = events.create(u, req(null, null));
    long def = calendars.ensureDefault(u);
    assertThat(created.calendarId()).isEqualTo(def);
    assertThat(created.effectiveColor()).isEqualTo("blue");
  }

  @Test
  void create_with_owned_calendar_uses_it() {
    long u = user();
    CalendarResponse c =
        calendars.create(u, new com.workplace.calendar.dto.CalendarRequest("업무", "red", null));
    var created = events.create(u, req(c.id(), null));
    assertThat(created.calendarId()).isEqualTo(c.id());
    assertThat(created.effectiveColor()).isEqualTo("red");
  }

  @Test
  void create_with_other_owner_calendar_rejected() {
    long u1 = user();
    long u2 = user();
    CalendarResponse c =
        calendars.create(u1, new com.workplace.calendar.dto.CalendarRequest("A", "blue", null));
    assertThatThrownBy(() -> events.create(u2, req(c.id(), null)))
        .isInstanceOf(CalendarNotFoundException.class);
  }

  @Test
  void create_with_invalid_override_color_rejected() {
    long u = user();
    assertThatThrownBy(() -> events.create(u, req(null, "#abcdef")))
        .isInstanceOf(IllegalArgumentException.class);
  }
}
