package com.workplace.calendar.dto;

/**
 * 내 캘린더 사용자 설정(WP-2169).
 *
 * @param defaultCalendarId 캘린더를 생략한 새 일정이 들어갈 실효 기본 캘린더 id — 지정한 캘린더가 쓸 수 없으면(삭제·읽기 전용·연결 해제) Works
 *     캘린더
 * @param outlookPrompted 「새 일정을 Outlook 캘린더에 만들까요?」를 이미 물었는지(WP-2171) — 한 번 물으면 다시 묻지 않는다
 */
public record CalendarUserSettingResponse(long defaultCalendarId, boolean outlookPrompted) {}
