package com.workplace.calendar.repository;

import static com.workplace.jooq.Tables.CALENDAR_EVENT;
import static com.workplace.jooq.Tables.EVENT_REMINDER;

import com.workplace.calendar.dto.CalendarEventRequest;
import com.workplace.calendar.dto.CalendarEventResponse;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.Optional;
import lombok.RequiredArgsConstructor;
import org.jooq.DSLContext;
import org.jooq.Record;
import org.springframework.stereotype.Repository;

/** calendar_event jOOQ 접근. 권한(owner) 검증은 service 책임. */
@Repository
@RequiredArgsConstructor
public class CalendarEventRepository {
  private final DSLContext dsl;

  /** 일정 생성 — 생성된 id 반환. */
  public long insert(long ownerId, CalendarEventRequest req) {
    return dsl.insertInto(CALENDAR_EVENT)
        .set(CALENDAR_EVENT.OWNER_ID, ownerId)
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

  /** 단건 조회(owner 무관) — service 에서 owner 검증. event_reminder 를 left join 해 reminderMinutes 포함. */
  public Optional<CalendarEventResponse> findById(long id) {
    return dsl.select(CALENDAR_EVENT.asterisk(), EVENT_REMINDER.LEAD_MINUTES)
        .from(CALENDAR_EVENT)
        .leftJoin(EVENT_REMINDER)
        .on(EVENT_REMINDER.EVENT_ID.eq(CALENDAR_EVENT.ID))
        .where(CALENDAR_EVENT.ID.eq(id))
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

  /**
   * owner 의 [from,to) 와 겹치는 구체(비반복) 일정 — starts_at < to AND ends_at > from. 반복 마스터(RRULE 보유)는 회차
   * 전개로 별도 처리하므로 제외한다. 오버라이드 일정은 RRULE 이 null 이라 여기서 그대로 반환된다.
   */
  public List<CalendarEventResponse> listByRange(
      long ownerId, OffsetDateTime from, OffsetDateTime to) {
    return dsl.select(CALENDAR_EVENT.asterisk(), EVENT_REMINDER.LEAD_MINUTES)
        .from(CALENDAR_EVENT)
        .leftJoin(EVENT_REMINDER)
        .on(EVENT_REMINDER.EVENT_ID.eq(CALENDAR_EVENT.ID))
        .where(CALENDAR_EVENT.OWNER_ID.eq(ownerId))
        .and(CALENDAR_EVENT.STARTS_AT.lt(to))
        .and(CALENDAR_EVENT.ENDS_AT.gt(from))
        .and(CALENDAR_EVENT.RECURRENCE_RULE.isNull())
        .orderBy(CALENDAR_EVENT.STARTS_AT.asc())
        .fetch(CalendarEventRepository::toResponse);
  }

  /**
   * owner 의 반복 마스터(RRULE 보유) 중 시작이 to 이전인 것 — starts_at < to. from 하한은 회차 전개(fastForward) 가 처리하므로
   * 두지 않는다(과거에 시작한 마스터의 미래 회차도 잡아야 함).
   */
  public List<CalendarEventResponse> listRecurringMasters(long ownerId, OffsetDateTime to) {
    return dsl.select(CALENDAR_EVENT.asterisk(), EVENT_REMINDER.LEAD_MINUTES)
        .from(CALENDAR_EVENT)
        .leftJoin(EVENT_REMINDER)
        .on(EVENT_REMINDER.EVENT_ID.eq(CALENDAR_EVENT.ID))
        .where(CALENDAR_EVENT.OWNER_ID.eq(ownerId))
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

  /** 삭제. */
  public void delete(long id) {
    dsl.deleteFrom(CALENDAR_EVENT).where(CALENDAR_EVENT.ID.eq(id)).execute();
  }

  private static CalendarEventResponse toResponse(Record r) {
    return new CalendarEventResponse(
        r.get(CALENDAR_EVENT.ID),
        r.get(CALENDAR_EVENT.TITLE),
        r.get(CALENDAR_EVENT.DESCRIPTION),
        r.get(CALENDAR_EVENT.STARTS_AT),
        r.get(CALENDAR_EVENT.ENDS_AT),
        r.get(CALENDAR_EVENT.ALL_DAY),
        r.get(CALENDAR_EVENT.LOCATION),
        r.get(CALENDAR_EVENT.COLOR),
        r.get(EVENT_REMINDER.LEAD_MINUTES),
        r.get(CALENDAR_EVENT.RECURRENCE_RULE),
        null, // masterEventId — 구체/마스터 행은 회차가 아니므로 null
        null, // occurrenceDate — 가상 회차에서만 채워짐
        r.get(CALENDAR_EVENT.CREATED_AT),
        r.get(CALENDAR_EVENT.UPDATED_AT));
  }

  private static String nullIfBlank(String s) {
    return (s == null || s.isBlank()) ? null : s;
  }
}
