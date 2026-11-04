package com.workplace.calendar;

import static com.workplace.jooq.Tables.CALENDAR;
import static com.workplace.jooq.Tables.CALENDAR_EVENT;
import static com.workplace.jooq.Tables.CALENDAR_EVENT_EXCEPTION;
import static com.workplace.jooq.Tables.EVENT_ATTENDEE;

import java.time.OffsetDateTime;
import org.jooq.DSLContext;

/** 일정 검색 테스트(WP-1357)가 함께 쓰는 시드 삽입 도우미 — 달력·일정·예외 행·참석자 행. */
final class CalendarSearchFixtures {

  private CalendarSearchFixtures() {}

  /** 로컬 달력(외부 계정 없음)을 넣고 id 를 돌려준다. */
  static long insertCalendar(DSLContext dsl, long ownerId) {
    return insertCalendar(dsl, ownerId, null);
  }

  /** 외부 계정(externalAccountId)에 이어진 달력 — null 이면 로컬 달력. */
  static long insertCalendar(DSLContext dsl, long ownerId, Long externalAccountId) {
    return dsl.insertInto(CALENDAR)
        .set(CALENDAR.OWNER_ID, ownerId)
        .set(CALENDAR.NAME, "cal")
        .set(CALENDAR.COLOR, "#3b82f6")
        .set(CALENDAR.IS_DEFAULT, false)
        .set(CALENDAR.POSITION, 0)
        .set(CALENDAR.EXTERNAL_ACCOUNT_ID, externalAccountId)
        .set(CALENDAR.EXTERNAL_ID, externalAccountId == null ? null : "ext-" + System.nanoTime())
        .returning(CALENDAR.ID)
        .fetchOne()
        .getId();
  }

  /** 단일 일정(1시간) — 장소를 지정한다. */
  static long insertEvent(
      DSLContext dsl,
      long ownerId,
      long calendarId,
      String title,
      String location,
      OffsetDateTime startsAt) {
    return insertEvent(dsl, ownerId, calendarId, title, location, startsAt, null);
  }

  /** 장소 없는 일정(1시간) — rrule 이 있으면 반복 마스터. */
  static long insertEvent(
      DSLContext dsl,
      long ownerId,
      long calendarId,
      String title,
      OffsetDateTime startsAt,
      String rrule) {
    return insertEvent(dsl, ownerId, calendarId, title, null, startsAt, rrule);
  }

  private static long insertEvent(
      DSLContext dsl,
      long ownerId,
      long calendarId,
      String title,
      String location,
      OffsetDateTime startsAt,
      String rrule) {
    return dsl.insertInto(CALENDAR_EVENT)
        .set(CALENDAR_EVENT.OWNER_ID, ownerId)
        .set(CALENDAR_EVENT.CALENDAR_ID, calendarId)
        .set(CALENDAR_EVENT.TITLE, title)
        .set(CALENDAR_EVENT.LOCATION, location)
        .set(CALENDAR_EVENT.STARTS_AT, startsAt)
        .set(CALENDAR_EVENT.ENDS_AT, startsAt.plusHours(1))
        .set(CALENDAR_EVENT.ALL_DAY, false)
        .set(CALENDAR_EVENT.RECURRENCE_RULE, rrule)
        .returning(CALENDAR_EVENT.ID)
        .fetchOne()
        .getId();
  }

  /**
   * 반복 마스터의 예외 행 — 취소(overrideEventId=null, cancelled=true) 또는 고친 회차(cancelled=false + 고친 행 id).
   */
  static void insertException(
      DSLContext dsl,
      long masterId,
      OffsetDateTime occurrenceDate,
      boolean cancelled,
      Long overrideEventId) {
    dsl.insertInto(CALENDAR_EVENT_EXCEPTION)
        .set(CALENDAR_EVENT_EXCEPTION.EVENT_ID, masterId)
        .set(CALENDAR_EVENT_EXCEPTION.OCCURRENCE_DATE, occurrenceDate)
        .set(CALENDAR_EVENT_EXCEPTION.IS_CANCELLED, cancelled)
        .set(CALENDAR_EVENT_EXCEPTION.OVERRIDE_EVENT_ID, overrideEventId)
        .execute();
  }

  /** 내부 사용자 참석자. */
  static void insertAttendee(DSLContext dsl, long eventId, long userId) {
    dsl.insertInto(EVENT_ATTENDEE)
        .set(EVENT_ATTENDEE.EVENT_ID, eventId)
        .set(EVENT_ATTENDEE.USER_ID, userId)
        .execute();
  }

  /** 외부 참석자(표시 이름·메일). */
  static void insertExternal(DSLContext dsl, long eventId, String name, String email) {
    dsl.insertInto(EVENT_ATTENDEE)
        .set(EVENT_ATTENDEE.EVENT_ID, eventId)
        .set(EVENT_ATTENDEE.EXTERNAL_NAME, name)
        .set(EVENT_ATTENDEE.EXTERNAL_EMAIL, email)
        .execute();
  }
}
