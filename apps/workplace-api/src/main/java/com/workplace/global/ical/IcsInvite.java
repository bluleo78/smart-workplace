package com.workplace.global.ical;

import java.time.OffsetDateTime;
import java.util.List;

/**
 * iCalendar 초대 한 건(WP-986) — {@link IcsParser} 가 VCALENDAR 의 METHOD 와 대표 VEVENT 하나에서 읽어 낸 값. 메일 초대
 * 카드와 응답(REPLY)·캘린더 반영이 함께 쓴다.
 *
 * @param method VCALENDAR METHOD(대문자, 예: REQUEST·CANCEL·REPLY). 없으면 null
 * @param uid VEVENT UID(필수 — 없으면 파서가 초대로 보지 않는다)
 * @param sequence SEQUENCE(없으면 0) — 같은 UID 의 더 큰 값이 최신 초대다
 * @param start 시작. 종일이면 그 날짜의 UTC 자정(M365 동기화 종일 일정과 같은 표현)
 * @param end 끝(배타). DTEND·DURATION 이 모두 없으면 null
 * @param allDay DTSTART 가 VALUE=DATE 인가
 * @param organizer 주최자(없으면 null)
 * @param attendees ATTENDEE 줄들(나타난 순서, 같은 이메일은 한 번)
 * @param cancelled VEVENT STATUS:CANCELLED 인가 — METHOD:CANCEL 과 함께 취소로 본다
 */
public record IcsInvite(
    String method,
    String uid,
    int sequence,
    String summary,
    OffsetDateTime start,
    OffsetDateTime end,
    boolean allDay,
    String location,
    Person organizer,
    List<Person> attendees,
    boolean cancelled) {

  /**
   * 사람(ORGANIZER·ATTENDEE) 한 명.
   *
   * @param email mailto: 를 뗀 이메일(소문자로 정규화)
   * @param name CN 매개변수(없으면 null)
   * @param partStat PARTSTAT(대문자, 없으면 null)
   */
  public record Person(String email, String name, String partStat) {}

  /** 취소 초대인가 — METHOD:CANCEL 이거나 VEVENT 가 STATUS:CANCELLED. */
  public boolean isCancel() {
    return "CANCEL".equals(method) || cancelled;
  }
}
