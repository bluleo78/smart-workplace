package com.workplace.calendar.dto;

import java.time.OffsetDateTime;
import java.util.List;

/**
 * 일정 키워드 검색 응답(WP-1357) — 한 페이지의 결과와 다음 페이지 커서.
 *
 * @param items 이번 페이지의 일정(다가오는 순 → 지난 순)
 * @param nextCursor 다음 페이지 시작 offset(문자열). 마지막 페이지면 null.
 * @param truncated 후보 상한(500)에 걸려 결과가 일부만 담겼는가. 마지막 페이지(nextCursor=null)에서도 잘린 것을 알 수 있게 한다.
 */
public record CalendarEventSearchResponse(List<Item> items, String nextCursor, boolean truncated) {

  /**
   * 검색 결과 한 줄 — 반복 일정은 시리즈당 한 줄.
   *
   * @param startsAt 마스터(또는 단일 일정)의 시작 시각
   * @param occurrenceStart 단일은 startsAt, 반복은 취소·옮긴 회차를 건너뛴 지금 이후 첫 회차(끝난 시리즈는 지금 이전 마지막 회차, 그것도 없으면
   *     마스터 startsAt). 오프셋은 마스터 startsAt 과 같다.
   * @param past 단일은 끝 시각이 지금 이전, 반복은 다음 회차가 없음
   * @param matchedField TITLE | LOCATION | ATTENDEE
   * @param matchedText 장소 값 또는 맞은 참석자 이름/메일. TITLE 이면 null.
   */
  public record Item(
      long id,
      String title,
      OffsetDateTime startsAt,
      OffsetDateTime endsAt,
      boolean allDay,
      String location,
      String calendarName,
      String calendarColor,
      String recurrenceRule,
      OffsetDateTime occurrenceStart,
      boolean past,
      String matchedField,
      String matchedText) {}
}
