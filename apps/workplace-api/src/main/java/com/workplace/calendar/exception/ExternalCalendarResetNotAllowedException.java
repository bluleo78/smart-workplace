package com.workplace.calendar.exception;

/** 외부 연동 캘린더는 일정 일괄 삭제(강제 리셋)할 수 없다. → 409 Conflict. */
public class ExternalCalendarResetNotAllowedException extends RuntimeException {
  public ExternalCalendarResetNotAllowedException(long id) {
    super("연동 캘린더는 일정을 일괄 삭제(리셋)할 수 없습니다: " + id);
  }
}
