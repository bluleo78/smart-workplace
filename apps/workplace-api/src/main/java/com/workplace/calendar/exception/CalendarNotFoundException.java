package com.workplace.calendar.exception;

/** 캘린더 미존재/비소유 — 존재 은닉 위해 404. */
public class CalendarNotFoundException extends RuntimeException {
  public CalendarNotFoundException(long id) {
    super("캘린더를 찾을 수 없습니다: " + id);
  }
}
