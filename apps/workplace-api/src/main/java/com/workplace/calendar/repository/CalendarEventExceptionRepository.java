package com.workplace.calendar.repository;

import static com.workplace.jooq.Tables.CALENDAR_EVENT_EXCEPTION;

import java.time.Instant;
import java.util.Collection;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Map;
import java.util.Set;
import lombok.RequiredArgsConstructor;
import org.jooq.DSLContext;
import org.springframework.stereotype.Repository;

/**
 * calendar_event_exception jOOQ 접근(읽기). 회차 전개 시 취소/오버라이드된 회차를 건너뛰기 위해 사용한다. 쓰기 경로(취소/오버라이드 생성)는
 * Task 4 에서 추가한다.
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
}
