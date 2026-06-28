package com.workplace.calendar.dto;

/** 캘린더 응답. isReadOnly=true 이면 외부 동기화 컨테이너(편집 불가). */
public record CalendarResponse(
    long id, String name, String color, boolean isDefault, int position, boolean isReadOnly) {}
