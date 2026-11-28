package com.workplace.calendar.dto;

import jakarta.validation.constraints.NotNull;

/**
 * 캘린더 사용자 설정 저장 요청(WP-2169). 값이 없으면(null) 400.
 *
 * @param calendarId 새 일정 기본 캘린더로 지정할 내 캘린더 id(Works 캘린더를 지정하면 Works 로 돌아간다)
 */
public record CalendarUserSettingUpdateRequest(@NotNull Long calendarId) {}
