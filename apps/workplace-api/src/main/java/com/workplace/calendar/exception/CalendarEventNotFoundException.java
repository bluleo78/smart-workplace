package com.workplace.calendar.exception;

/** 일정 미존재 또는 비-owner 접근. 존재 은닉을 위해 비-owner 도 404 로 매핑한다. */
public class CalendarEventNotFoundException extends RuntimeException {
  public CalendarEventNotFoundException(long id) {
    super("calendar event " + id + " not found");
  }
}
