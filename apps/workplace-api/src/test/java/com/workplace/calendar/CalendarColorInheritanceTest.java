package com.workplace.calendar;

import static com.workplace.jooq.Tables.CALENDAR;
import static com.workplace.jooq.Tables.CALENDAR_EVENT;
import static com.workplace.jooq.Tables.USER;
import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.calendar.dto.CalendarEventResponse;
import com.workplace.calendar.service.CalendarEventService;
import com.workplace.support.IntegrationTestBase;
import java.time.OffsetDateTime;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.annotation.Transactional;

/**
 * effectiveColor read-time 해석: 상속(event.color null → calendar.color), override(event.color 우선), 캘린더
 * 색 변경 즉시 반영.
 */
@Transactional
class CalendarColorInheritanceTest extends IntegrationTestBase {
  @Autowired DSLContext dsl;
  @Autowired CalendarEventService events;

  private long user() {
    String t = UUID.randomUUID().toString().replace("-", "").substring(0, 8);
    return dsl.insertInto(USER)
        .set(USER.USERNAME, "ci_" + t)
        .set(USER.PASSWORD, "pw")
        .set(USER.NAME, "U " + t)
        .set(USER.EMAIL, t + "@example.com")
        .set(USER.KIND, "HUMAN")
        .returning(USER.ID)
        .fetchOne()
        .getId();
  }

  private long calendar(long owner, String color) {
    return dsl.insertInto(CALENDAR)
        .set(CALENDAR.OWNER_ID, owner)
        .set(CALENDAR.NAME, "C")
        .set(CALENDAR.COLOR, color)
        .set(CALENDAR.IS_DEFAULT, false)
        .returning(CALENDAR.ID)
        .fetchOne()
        .getId();
  }

  private long event(long owner, long calId, String overrideColor) {
    return dsl.insertInto(CALENDAR_EVENT)
        .set(CALENDAR_EVENT.OWNER_ID, owner)
        .set(CALENDAR_EVENT.TITLE, "e")
        .set(CALENDAR_EVENT.STARTS_AT, OffsetDateTime.parse("2026-06-10T09:00:00Z"))
        .set(CALENDAR_EVENT.ENDS_AT, OffsetDateTime.parse("2026-06-10T10:00:00Z"))
        .set(CALENDAR_EVENT.CALENDAR_ID, calId)
        .set(CALENDAR_EVENT.COLOR, overrideColor)
        .returning(CALENDAR_EVENT.ID)
        .fetchOne()
        .getId();
  }

  @Test
  void inherits_calendar_color_when_event_color_null() {
    long u = user();
    long cal = calendar(u, "green");
    long ev = event(u, cal, null);
    CalendarEventResponse r = events.get(u, ev);
    assertThat(r.effectiveColor()).isEqualTo("green");
    assertThat(r.color()).isNull();
    assertThat(r.calendarId()).isEqualTo(cal);
  }

  @Test
  void override_takes_precedence() {
    long u = user();
    long cal = calendar(u, "green");
    long ev = event(u, cal, "red");
    CalendarEventResponse r = events.get(u, ev);
    assertThat(r.effectiveColor()).isEqualTo("red");
    assertThat(r.color()).isEqualTo("red");
  }

  @Test
  void calendar_color_change_reflects_immediately() {
    long u = user();
    long cal = calendar(u, "green");
    long ev = event(u, cal, null);
    dsl.update(CALENDAR).set(CALENDAR.COLOR, "violet").where(CALENDAR.ID.eq(cal)).execute();
    assertThat(events.get(u, ev).effectiveColor()).isEqualTo("violet");
  }

  /** 반복 마스터의 가상 회차도 캘린더 색을 상속해야 한다(toOccurrence 전파 검증 — 회차가 'blue' 폴백으로 떨어지지 않는지). */
  @Test
  void recurring_occurrences_inherit_calendar_color() {
    long u = user();
    long cal = calendar(u, "green");
    // FREQ=DAILY 마스터(첫 회차=BASE). color 미지정(상속).
    dsl.insertInto(CALENDAR_EVENT)
        .set(CALENDAR_EVENT.OWNER_ID, u)
        .set(CALENDAR_EVENT.TITLE, "rec")
        .set(CALENDAR_EVENT.STARTS_AT, OffsetDateTime.parse("2026-06-10T09:00:00Z"))
        .set(CALENDAR_EVENT.ENDS_AT, OffsetDateTime.parse("2026-06-10T10:00:00Z"))
        .set(CALENDAR_EVENT.CALENDAR_ID, cal)
        .set(CALENDAR_EVENT.RECURRENCE_RULE, "FREQ=DAILY")
        .execute();
    var list =
        events.list(
            u,
            OffsetDateTime.parse("2026-06-10T00:00:00Z"),
            OffsetDateTime.parse("2026-06-13T00:00:00Z"));
    assertThat(list).isNotEmpty();
    assertThat(list)
        .allSatisfy(
            e -> {
              assertThat(e.effectiveColor()).isEqualTo("green");
              assertThat(e.calendarId()).isEqualTo(cal);
            });
  }
}
