package com.workplace.calendar.repository;

import static com.workplace.jooq.Tables.CALENDAR_EVENT;

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
        .returning(CALENDAR_EVENT.ID)
        .fetchOne()
        .getId();
  }

  /** 단건 조회(owner 무관) — service 에서 owner 검증. */
  public Optional<CalendarEventResponse> findById(long id) {
    return dsl.selectFrom(CALENDAR_EVENT)
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

  /** owner 의 [from,to) 와 겹치는 일정 — starts_at < to AND ends_at > from. */
  public List<CalendarEventResponse> listByRange(
      long ownerId, OffsetDateTime from, OffsetDateTime to) {
    return dsl.selectFrom(CALENDAR_EVENT)
        .where(CALENDAR_EVENT.OWNER_ID.eq(ownerId))
        .and(CALENDAR_EVENT.STARTS_AT.lt(to))
        .and(CALENDAR_EVENT.ENDS_AT.gt(from))
        .orderBy(CALENDAR_EVENT.STARTS_AT.asc())
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
        r.get(CALENDAR_EVENT.CREATED_AT),
        r.get(CALENDAR_EVENT.UPDATED_AT));
  }

  private static String nullIfBlank(String s) {
    return (s == null || s.isBlank()) ? null : s;
  }
}
