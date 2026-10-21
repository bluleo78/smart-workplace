package com.workplace.calendar.exception;

/** 외부 연동 캘린더는 일정 일괄 삭제(강제 리셋)할 수 없다. → 409 Conflict. */
public class ExternalCalendarResetNotAllowedException extends RuntimeException {
  public ExternalCalendarResetNotAllowedException(long id) {
    // 문구에 id·영문 값을 넣지 않는다 — 응답 message 로 그대로 나가 화면·AI 에 내부 번호가 보였다(WP-672, WP-619 후속)
    super("연동 캘린더는 일정을 일괄 삭제(리셋)할 수 없습니다");
  }
}
