package com.workplace.calendar.exception;

/** 외부 공급자(M365 Graph) 일정 쓰기 실패 — 업스트림 오류이므로 502 로 매핑. */
public class ExternalCalendarWriteException extends RuntimeException {
  public ExternalCalendarWriteException(String message, Throwable cause) {
    super(message, cause);
  }
}
