package com.workplace.calendar.exception;

/** 외부(M365) 쓰기 캘린더는 단일 일정만 역동기화한다 — 반복 시도는 422. 반복 양방향은 #546. */
public class RecurringNotSupportedOnExternalCalendarException extends RuntimeException {
  public RecurringNotSupportedOnExternalCalendarException() {
    super("외부 동기화 캘린더에는 반복 일정을 만들 수 없습니다. 단일 일정만 지원됩니다.");
  }
}
