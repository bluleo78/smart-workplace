package com.workplace.calendar.dto;

/** 일정 응답에 달려 오는 태그 요약(WP-714) — 칩을 그리는 데 필요한 값만. color 는 팔레트 키(blue … gray). */
public record CalendarTagRef(long id, String name, String color) {}
