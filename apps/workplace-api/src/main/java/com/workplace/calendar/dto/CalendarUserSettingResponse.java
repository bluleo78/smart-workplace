package com.workplace.calendar.dto;

/**
 * 내 캘린더 사용자 설정(WP-2169).
 *
 * @param defaultCalendarId 캘린더를 생략한 새 일정이 들어갈 실효 기본 캘린더 id — 지정한 캘린더가 쓸 수 없으면(삭제·읽기 전용·연결 해제) Works
 *     캘린더
 */
public record CalendarUserSettingResponse(long defaultCalendarId) {}
