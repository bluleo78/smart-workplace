package com.workplace.calendar.dto;

import java.time.OffsetDateTime;

/**
 * 일정 응답.
 *
 * @param reminderMinutes 설정된 리마인더(시작 N분 전). 없으면 null.
 * @param recurrenceRule 저장된 RRULE(반복 마스터/가상 회차에 채워짐). 단일 일정은 null.
 * @param masterEventId 가상 회차일 때 원본(마스터) 일정 id. 구체 일정은 null.
 * @param occurrenceDate 가상 회차의 시작 시각(ISO-8601 UTC 문자열) — 회차 식별 키. 구체 일정은 null.
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
    String recurrenceRule,
    Long masterEventId,
    String occurrenceDate,
    OffsetDateTime createdAt,
    OffsetDateTime updatedAt) {}
