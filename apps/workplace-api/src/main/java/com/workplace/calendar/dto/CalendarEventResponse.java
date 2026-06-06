package com.workplace.calendar.dto;

import java.time.OffsetDateTime;

/**
 * 일정 응답.
 *
 * @param reminderMinutes 설정된 리마인더(시작 N분 전). 없으면 null.
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
    Integer reminderMinutes,
    OffsetDateTime createdAt,
    OffsetDateTime updatedAt) {}
