package com.workplace.calendar.dto;

import java.time.OffsetDateTime;
import java.util.List;

/**
 * 일정 응답.
 *
 * @param calendarId 소속 캘린더 id. @param calendarName 소속 캘린더 이름.
 * @param effectiveColor 표시용 해석 색 = color(override) ?? 캘린더 색 ?? 'blue'. 항상 non-null.
 * @param reminderMinutes 설정된 리마인더(시작 N분 전). 없으면 null.
 * @param recurrenceRule 저장된 RRULE(반복 마스터/가상 회차에 채워짐). 단일 일정은 null.
 * @param masterEventId 가상 회차일 때 원본(마스터) 일정 id. 구체 일정은 null.
 * @param occurrenceDate 가상 회차의 시작 시각(ISO-8601 UTC 문자열) — 회차 식별 키. 구체 일정은 null.
 * @param attendeeCount 참석자 총원(주최자 포함). list 경량 응답에서도 채움.
 * @param myRsvpStatus 호출자 본인의 RSVP 상태. 참석자가 아니면 null.
 * @param attendees 전체 참석자 목록. get() 에서만 채움, list() 는 null.
 * @param external 외부 동기화 일정 여부(external_id 존재). get() 에서만 채움, list() 는 false.
 * @param myRole 호출자의 역할(ORGANIZER/ATTENDEE). 참석자 아니면 null. get() 에서만 채움.
 * @param iCalUid 외부 동기화 미팅의 공급자 표준 식별자(iCalUId). 순수 로컬 이벤트는 null. 크로스소스 dedup 키.
 * @param onlineMeeting 온라인 회의 참가 정보(WP-710). 저장된 M365 참가 주소 → 설명·장소의 첫 회의 링크 순으로 서버가 판정. 회의가 아니면
 *     null.
 * @param tags 이 일정에 붙은 호출자 본인의 태그(WP-714) — 태그는 사람마다 따로라 남의 태그는 싣지 않는다. 반복 회차·고친 회차는 마스터의 태그를 따른다.
 *     서비스가 채우기 전(저장소 행 변환 직후)에는 빈 목록.
 * @param tagsEditable 앱에서 태그를 붙이고 뗄 수 있는지 — 외부(M365) 동기화 일정은 Outlook 범주에서 오므로 범주 써 넣기(WP-716) 전까지
 *     false.
 */
public record CalendarEventResponse(
    long id,
    String title,
    String description,
    OffsetDateTime startsAt,
    OffsetDateTime endsAt,
    boolean allDay,
    String location,
    String color,
    Long calendarId,
    String calendarName,
    String effectiveColor,
    Integer reminderMinutes,
    String recurrenceRule,
    Long masterEventId,
    String occurrenceDate,
    OffsetDateTime createdAt,
    OffsetDateTime updatedAt,
    int attendeeCount,
    String myRsvpStatus,
    List<AttendeeResponse> attendees,
    boolean external,
    String myRole,
    String iCalUid,
    OnlineMeeting onlineMeeting,
    List<CalendarTagRef> tags,
    boolean tagsEditable) {

  /** 태그만 바꾼 복사본 — 서비스가 목록·상세 응답에 호출자 태그를 한 번에 채울 때 쓴다(WP-714). */
  public CalendarEventResponse withTags(List<CalendarTagRef> newTags) {
    return new CalendarEventResponse(
        id,
        title,
        description,
        startsAt,
        endsAt,
        allDay,
        location,
        color,
        calendarId,
        calendarName,
        effectiveColor,
        reminderMinutes,
        recurrenceRule,
        masterEventId,
        occurrenceDate,
        createdAt,
        updatedAt,
        attendeeCount,
        myRsvpStatus,
        attendees,
        external,
        myRole,
        iCalUid,
        onlineMeeting,
        newTags,
        tagsEditable);
  }
}
