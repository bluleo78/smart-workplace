package com.workplace.calendar.dto;

import java.time.OffsetDateTime;

/** 일정 응답. */
public record CalendarEventResponse(
    long id,
    String title,
    String description,
    OffsetDateTime startsAt,
    OffsetDateTime endsAt,
    boolean allDay,
    String location,
    String color,
    OffsetDateTime createdAt,
    OffsetDateTime updatedAt) {}
