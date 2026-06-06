package com.workplace.calendar.repository;

import static com.workplace.jooq.Tables.CALENDAR_EVENT_EXCEPTION;

import java.time.Instant;
import java.time.OffsetDateTime;
import java.util.Collection;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import lombok.RequiredArgsConstructor;
import org.jooq.DSLContext;
import org.springframework.stereotype.Repository;

/**
 * calendar_event_exception jOOQ 접근. 회차 전개 시 취소/오버라이드된 회차를 건너뛰기 위한 읽기와, 회차 단위 편집/삭제(취소·오버라이드)를 위한
 * 쓰기를 제공한다. 회차 식별 키 occurrence_date 는 timestamptz 이므로 항상 Instant(절대 시각) 로 매칭한다(문자열 비교 금지).
 */
@Repository
@RequiredArgsConstructor
public class CalendarEventExceptionRepository {
  private final DSLContext dsl;

  /**
   * 마스터 event_id 들의 예외 회차 시각을 Instant 집합으로 반환(키=event_id). occurrence_date 는 timestamptz 이므로 문자열이
   * 아닌 epoch-millis(Instant) 로 비교한다. 예외 행이 있으면 취소든 오버라이드든 가상 회차 전개에서 제외 대상이다.
   */
  public Map<Long, Set<Instant>> occurrencesByEvent(Collection<Long> eventIds) {
    Map<Long, Set<Instant>> result = new HashMap<>();
    if (eventIds.isEmpty()) {
      return result;
    }
    dsl.select(CALENDAR_EVENT_EXCEPTION.EVENT_ID, CALENDAR_EVENT_EXCEPTION.OCCURRENCE_DATE)
        .from(CALENDAR_EVENT_EXCEPTION)
        .where(CALENDAR_EVENT_EXCEPTION.EVENT_ID.in(eventIds))
        .fetch()
        .forEach(
            r ->
                result
                    .computeIfAbsent(r.get(CALENDAR_EVENT_EXCEPTION.EVENT_ID), k -> new HashSet<>())
                    .add(r.get(CALENDAR_EVENT_EXCEPTION.OCCURRENCE_DATE).toInstant()));
    return result;
  }

  /**
   * 회차 취소 예외 upsert(THIS 삭제). 해당 (event_id, occurrence_date) 회차를 is_cancelled=true 로 기록한다. 이미 예외 행이
   * 있으면(오버라이드였더라도) 취소로 덮어쓰며 override_event_id 는 null 로 비운다. (override 였다면 그 별도 일정은 고아로 남음 — v1b 한계)
   */
  public void insertCancellation(long eventId, OffsetDateTime occurrenceDate) {
    dsl.insertInto(CALENDAR_EVENT_EXCEPTION)
        .set(CALENDAR_EVENT_EXCEPTION.EVENT_ID, eventId)
        .set(CALENDAR_EVENT_EXCEPTION.OCCURRENCE_DATE, occurrenceDate)
        .set(CALENDAR_EVENT_EXCEPTION.IS_CANCELLED, true)
        .set(CALENDAR_EVENT_EXCEPTION.OVERRIDE_EVENT_ID, (Long) null)
        .onConflict(CALENDAR_EVENT_EXCEPTION.EVENT_ID, CALENDAR_EVENT_EXCEPTION.OCCURRENCE_DATE)
        .doUpdate()
        .set(CALENDAR_EVENT_EXCEPTION.IS_CANCELLED, true)
        .set(CALENDAR_EVENT_EXCEPTION.OVERRIDE_EVENT_ID, (Long) null)
        .execute();
  }

  /**
   * 회차 오버라이드 예외 upsert(THIS 수정). 해당 회차를 별도 일정(overrideEventId) 으로 대체하고 취소 플래그는 내린다. 재편집 시 기존 예외 행을
   * override_event_id 만 갱신한다.
   */
  public void upsertOverride(long eventId, OffsetDateTime occurrenceDate, long overrideEventId) {
    dsl.insertInto(CALENDAR_EVENT_EXCEPTION)
        .set(CALENDAR_EVENT_EXCEPTION.EVENT_ID, eventId)
        .set(CALENDAR_EVENT_EXCEPTION.OCCURRENCE_DATE, occurrenceDate)
        .set(CALENDAR_EVENT_EXCEPTION.IS_CANCELLED, false)
        .set(CALENDAR_EVENT_EXCEPTION.OVERRIDE_EVENT_ID, overrideEventId)
        .onConflict(CALENDAR_EVENT_EXCEPTION.EVENT_ID, CALENDAR_EVENT_EXCEPTION.OCCURRENCE_DATE)
        .doUpdate()
        .set(CALENDAR_EVENT_EXCEPTION.IS_CANCELLED, false)
        .set(CALENDAR_EVENT_EXCEPTION.OVERRIDE_EVENT_ID, overrideEventId)
        .execute();
  }

  /**
   * 회차의 기존 오버라이드 일정 id 조회(재편집용). 행이 없거나 취소 예외(override_event_id=null) 이면 비어있음 — 둘 다 "재사용할 오버라이드
   * 없음"으로 동일하게 처리한다.
   */
  public Optional<Long> findOverrideEventId(long eventId, OffsetDateTime occurrenceDate) {
    return dsl.select(CALENDAR_EVENT_EXCEPTION.OVERRIDE_EVENT_ID)
        .from(CALENDAR_EVENT_EXCEPTION)
        .where(CALENDAR_EVENT_EXCEPTION.EVENT_ID.eq(eventId))
        .and(CALENDAR_EVENT_EXCEPTION.OCCURRENCE_DATE.eq(occurrenceDate))
        .fetchOptional()
        .map(r -> r.get(CALENDAR_EVENT_EXCEPTION.OVERRIDE_EVENT_ID));
  }

  /**
   * 마스터의 오버라이드 일정 id 목록(THIS·ALL 삭제 시 고아 정리용). 마스터 삭제는 override 별도 일정을 cascade 하지 않으므로 서비스가 직접 지운다.
   */
  public List<Long> overrideEventIds(long eventId) {
    return dsl.select(CALENDAR_EVENT_EXCEPTION.OVERRIDE_EVENT_ID)
        .from(CALENDAR_EVENT_EXCEPTION)
        .where(CALENDAR_EVENT_EXCEPTION.EVENT_ID.eq(eventId))
        .and(CALENDAR_EVENT_EXCEPTION.OVERRIDE_EVENT_ID.isNotNull())
        .fetch(CALENDAR_EVENT_EXCEPTION.OVERRIDE_EVENT_ID);
  }

  /**
   * occurrence_date 가 cutoff 이상인 예외 행 삭제(THIS_AND_FOLLOWING). 시리즈를 자른 뒤 더 이상 의미 없는 미래 예외(취소/오버라이드
   * 행)를 제거한다. (오버라이드였던 별도 일정 자체는 고아로 남음 — v1b 한계)
   */
  public void deleteFromOccurrence(long eventId, OffsetDateTime occurrenceDate) {
    dsl.deleteFrom(CALENDAR_EVENT_EXCEPTION)
        .where(CALENDAR_EVENT_EXCEPTION.EVENT_ID.eq(eventId))
        .and(CALENDAR_EVENT_EXCEPTION.OCCURRENCE_DATE.ge(occurrenceDate))
        .execute();
  }
}
