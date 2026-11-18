package com.workplace.calendar.dto;

import java.time.OffsetDateTime;

/**
 * 노트에 이어진 일정 한 건(WP-1703) — 노트 하단 「연결된 일정」 행이 쓰는 요약. 반복 회차는 {@code eventId} 가 마스터, {@code
 * occurrenceDate} 가 그 회차의 원래 시작 시각(ISO UTC, 예 {@code 2026-11-18T01:00:00Z})이고, 반복 아님·M365 회차 행은 그 행
 * id 와 null 이다. 「이 회차만」 옮긴 회차면 제목·시각·참석 수는 옮긴(override) 일정 것이다.
 *
 * <p>occurrenceDate 가 null 이어도 JSON 에 {@code "occurrenceDate": null} 로 싣는다 — NON_NULL 을 달지 않는다.
 *
 * @param eventId 반복이면 마스터 id, 그 밖엔 그 일정 행 id
 * @param occurrenceDate 반복 회차의 원래 시작 시각(Instant 문자열). 반복 아님은 null
 * @param overrideEventId 「이 회차만」 옮긴 회차면 그 override 일정 행 id, 아니면 null(WP-1703) — 일정 목록은 옮긴 회차를 마스터
 *     가상 회차가 아니라 이 id 의 단일 행으로 돌려주므로, 캘린더 딥링크는 (마스터, 회차) 대신 이 id 로 그 회차를 연다. 행 식별 키는 여전히
 *     eventId+occurrenceDate 다.
 * @param attendeeCount event_attendee 행 수(주최자 포함, 목록 응답과 같은 셈)
 */
public record NoteLinkedEventResponse(
    long eventId,
    String occurrenceDate,
    Long overrideEventId,
    String title,
    OffsetDateTime startsAt,
    OffsetDateTime endsAt,
    boolean allDay,
    int attendeeCount) {}
