package com.workplace.calendar.repository;

import static com.workplace.jooq.Tables.CALENDAR;
import static com.workplace.jooq.Tables.CALENDAR_EVENT;
import static com.workplace.jooq.Tables.EVENT_ATTENDEE;
import static com.workplace.jooq.Tables.EVENT_REMINDER;

import com.workplace.calendar.dto.CalendarEventRequest;
import com.workplace.calendar.dto.CalendarEventResponse;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.Optional;
import lombok.RequiredArgsConstructor;
import org.jooq.Condition;
import org.jooq.DSLContext;
import org.jooq.Record;
import org.jooq.impl.DSL;
import org.springframework.stereotype.Repository;

/** calendar_event jOOQ 접근. 읽기 접근은 owner OR event_attendee 참석자(accessibleBy 술어). */
@Repository
@RequiredArgsConstructor
public class CalendarEventRepository {
  private final DSLContext dsl;

  /**
   * 읽기 접근 술어: owner 이거나 event_attendee 테이블에 참석자 행이 있으면 접근 가능. list(구체/반복마스터)와 단건 조회 세 경로에 공통 적용해
   * 초대받은 사용자도 자신의 일정을 볼 수 있도록 한다(가시성 역전).
   */
  public static Condition accessibleBy(long callerId) {
    return CALENDAR_EVENT
        .OWNER_ID
        .eq(callerId)
        .or(
            DSL.exists(
                DSL.selectOne()
                    .from(EVENT_ATTENDEE)
                    .where(EVENT_ATTENDEE.EVENT_ID.eq(CALENDAR_EVENT.ID))
                    .and(EVENT_ATTENDEE.USER_ID.eq(callerId))));
  }

  /** 일정 생성 — calendarId resolve 완료 후 호출. 생성된 id 반환. */
  public long insert(long ownerId, long calendarId, CalendarEventRequest req) {
    return dsl.insertInto(CALENDAR_EVENT)
        .set(CALENDAR_EVENT.OWNER_ID, ownerId)
        .set(CALENDAR_EVENT.CALENDAR_ID, calendarId)
        .set(CALENDAR_EVENT.TITLE, req.title())
        .set(CALENDAR_EVENT.DESCRIPTION, nullIfBlank(req.description()))
        .set(CALENDAR_EVENT.STARTS_AT, req.startsAt())
        .set(CALENDAR_EVENT.ENDS_AT, req.endsAt())
        .set(CALENDAR_EVENT.ALL_DAY, req.allDay())
        .set(CALENDAR_EVENT.LOCATION, nullIfBlank(req.location()))
        .set(CALENDAR_EVENT.COLOR, nullIfBlank(req.color()))
        .set(CALENDAR_EVENT.RECURRENCE_RULE, nullIfBlank(req.recurrenceRule()))
        .returning(CALENDAR_EVENT.ID)
        .fetchOne()
        .getId();
  }

  /** 단일 일정의 소속 캘린더 변경(수정 시 캘린더 이동). */
  public void moveSingleEventToCalendar(long id, long calendarId) {
    dsl.update(CALENDAR_EVENT)
        .set(CALENDAR_EVENT.CALENDAR_ID, calendarId)
        .set(CALENDAR_EVENT.UPDATED_AT, OffsetDateTime.now())
        .where(CALENDAR_EVENT.ID.eq(id))
        .execute();
  }

  /**
   * 단건 조회 — callerId 가 owner 이거나 참석자인 경우에만 반환(없으면 Optional.empty → service 가 404 처리).
   * event_reminder 를 left join 해 reminderMinutes 포함.
   */
  public Optional<CalendarEventResponse> findById(long callerId, long id) {
    return dsl.select(
            CALENDAR_EVENT.asterisk(),
            EVENT_REMINDER.LEAD_MINUTES,
            CALENDAR.NAME.as("cal_name"),
            CALENDAR.COLOR.as("cal_color"))
        .from(CALENDAR_EVENT)
        .leftJoin(EVENT_REMINDER)
        .on(EVENT_REMINDER.EVENT_ID.eq(CALENDAR_EVENT.ID))
        .leftJoin(CALENDAR)
        .on(CALENDAR.ID.eq(CALENDAR_EVENT.CALENDAR_ID))
        .where(CALENDAR_EVENT.ID.eq(id))
        .and(accessibleBy(callerId))
        .fetchOptional()
        .map(CalendarEventRepository::toResponse);
  }

  /** 단건 owner 조회 — 권한 검증용. */
  public Optional<Long> findOwnerId(long id) {
    return dsl.select(CALENDAR_EVENT.OWNER_ID)
        .from(CALENDAR_EVENT)
        .where(CALENDAR_EVENT.ID.eq(id))
        .fetchOptional(CALENDAR_EVENT.OWNER_ID);
  }

  /** 일정이 속한 캘린더의 읽기전용 여부. 존재하지 않는 id 는 false 반환. */
  public boolean isEventCalendarReadOnly(long eventId) {
    return Boolean.TRUE.equals(
        dsl.select(CALENDAR.IS_READ_ONLY)
            .from(CALENDAR_EVENT)
            .join(CALENDAR)
            .on(CALENDAR.ID.eq(CALENDAR_EVENT.CALENDAR_ID))
            .where(CALENDAR_EVENT.ID.eq(eventId))
            .fetchOne(CALENDAR.IS_READ_ONLY));
  }

  /**
   * callerId 가 접근 가능한(owner 또는 참석자) 구체(비반복) 일정 중 [from, to) 와 겹치는 것. 반복 마스터(RRULE 보유)는 회차 전개로 별도
   * 처리하므로 제외. 오버라이드 일정은 RRULE 이 null 이라 여기서 그대로 반환된다.
   */
  public List<CalendarEventResponse> listByRange(
      long callerId, OffsetDateTime from, OffsetDateTime to) {
    return dsl.select(
            CALENDAR_EVENT.asterisk(),
            EVENT_REMINDER.LEAD_MINUTES,
            CALENDAR.NAME.as("cal_name"),
            CALENDAR.COLOR.as("cal_color"))
        .from(CALENDAR_EVENT)
        .leftJoin(EVENT_REMINDER)
        .on(EVENT_REMINDER.EVENT_ID.eq(CALENDAR_EVENT.ID))
        .leftJoin(CALENDAR)
        .on(CALENDAR.ID.eq(CALENDAR_EVENT.CALENDAR_ID))
        .where(accessibleBy(callerId))
        .and(CALENDAR_EVENT.STARTS_AT.lt(to))
        .and(CALENDAR_EVENT.ENDS_AT.gt(from))
        .and(CALENDAR_EVENT.RECURRENCE_RULE.isNull())
        .orderBy(CALENDAR_EVENT.STARTS_AT.asc())
        .fetch(CalendarEventRepository::toResponse);
  }

  /**
   * callerId 가 접근 가능한(owner 또는 참석자) 반복 마스터(RRULE 보유) 중 시작이 to 이전인 것. from 하한은 회차 전개(fastForward) 가
   * 처리하므로 두지 않는다(과거에 시작한 마스터의 미래 회차도 잡아야 함).
   */
  public List<CalendarEventResponse> listRecurringMasters(long callerId, OffsetDateTime to) {
    return dsl.select(
            CALENDAR_EVENT.asterisk(),
            EVENT_REMINDER.LEAD_MINUTES,
            CALENDAR.NAME.as("cal_name"),
            CALENDAR.COLOR.as("cal_color"))
        .from(CALENDAR_EVENT)
        .leftJoin(EVENT_REMINDER)
        .on(EVENT_REMINDER.EVENT_ID.eq(CALENDAR_EVENT.ID))
        .leftJoin(CALENDAR)
        .on(CALENDAR.ID.eq(CALENDAR_EVENT.CALENDAR_ID))
        .where(accessibleBy(callerId))
        .and(CALENDAR_EVENT.RECURRENCE_RULE.isNotNull())
        .and(CALENDAR_EVENT.STARTS_AT.lt(to))
        .fetch(CalendarEventRepository::toResponse);
  }

  /** 전체 교체 + updated_at 갱신. */
  public void update(long id, CalendarEventRequest req) {
    dsl.update(CALENDAR_EVENT)
        .set(CALENDAR_EVENT.TITLE, req.title())
        .set(CALENDAR_EVENT.DESCRIPTION, nullIfBlank(req.description()))
        .set(CALENDAR_EVENT.STARTS_AT, req.startsAt())
        .set(CALENDAR_EVENT.ENDS_AT, req.endsAt())
        .set(CALENDAR_EVENT.ALL_DAY, req.allDay())
        .set(CALENDAR_EVENT.LOCATION, nullIfBlank(req.location()))
        .set(CALENDAR_EVENT.COLOR, nullIfBlank(req.color()))
        .set(CALENDAR_EVENT.RECURRENCE_RULE, nullIfBlank(req.recurrenceRule()))
        .set(CALENDAR_EVENT.UPDATED_AT, OffsetDateTime.now())
        .where(CALENDAR_EVENT.ID.eq(id))
        .execute();
  }

  /** RRULE 만 교체 + updated_at 갱신 — 시리즈 잘라내기(UNTIL 적용)에 사용. */
  public void updateRecurrenceRule(long id, String recurrenceRule) {
    dsl.update(CALENDAR_EVENT)
        .set(CALENDAR_EVENT.RECURRENCE_RULE, nullIfBlank(recurrenceRule))
        .set(CALENDAR_EVENT.UPDATED_AT, OffsetDateTime.now())
        .where(CALENDAR_EVENT.ID.eq(id))
        .execute();
  }

  /** 삭제. */
  public void delete(long id) {
    dsl.deleteFrom(CALENDAR_EVENT).where(CALENDAR_EVENT.ID.eq(id)).execute();
  }

  /** 여러 일정 일괄 삭제 — 마스터 삭제 시 고아가 된 오버라이드 일정 정리에 사용. */
  public void deleteAllById(java.util.Collection<Long> ids) {
    if (ids.isEmpty()) {
      return;
    }
    dsl.deleteFrom(CALENDAR_EVENT).where(CALENDAR_EVENT.ID.in(ids)).execute();
  }

  private static CalendarEventResponse toResponse(Record r) {
    String override = r.get(CALENDAR_EVENT.COLOR);
    String calColor = r.get("cal_color", String.class); // alias 로 충돌 회피. 조인 없으면 null
    String calName = r.get("cal_name", String.class);
    // 표시용 해석 색: override 우선 → 캘린더 색 → 팔레트 기본('blue'). 항상 non-null.
    String effective = override != null ? override : (calColor != null ? calColor : "blue");
    return new CalendarEventResponse(
        r.get(CALENDAR_EVENT.ID),
        r.get(CALENDAR_EVENT.TITLE),
        r.get(CALENDAR_EVENT.DESCRIPTION),
        r.get(CALENDAR_EVENT.STARTS_AT),
        r.get(CALENDAR_EVENT.ENDS_AT),
        r.get(CALENDAR_EVENT.ALL_DAY),
        r.get(CALENDAR_EVENT.LOCATION),
        override,
        r.get(CALENDAR_EVENT.CALENDAR_ID),
        calName,
        effective,
        r.get(EVENT_REMINDER.LEAD_MINUTES),
        r.get(CALENDAR_EVENT.RECURRENCE_RULE),
        null, // masterEventId — 구체/마스터 행은 회차가 아니므로 null
        null, // occurrenceDate — 가상 회차에서만 채워짐
        r.get(CALENDAR_EVENT.CREATED_AT),
        r.get(CALENDAR_EVENT.UPDATED_AT),
        0, // attendeeCount — 서비스 계층 enrich 전 기본값
        null, // myRsvpStatus — 서비스 계층 enrich 전 기본값
        null); // attendees — 서비스 계층 enrich 전 기본값
  }

  private static String nullIfBlank(String s) {
    return (s == null || s.isBlank()) ? null : s;
  }
}
