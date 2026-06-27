package com.workplace.calendar.dto;

/** 캘린더 응답. */
public record CalendarResponse(
    long id, String name, String color, boolean isDefault, int position) {}
