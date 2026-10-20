package com.workplace.calendar.exception;

/** 일정 미존재 또는 비-owner 접근. 존재 은닉을 위해 비-owner 도 404 로 매핑한다. */
public class CalendarEventNotFoundException extends RuntimeException {
  public CalendarEventNotFoundException(long id) {
    // 문구에 id 를 넣지 않는다 — 응답 message 로 그대로 나가 화면·AI 에 내부 번호가 보였다(WP-619)
    super("일정을 찾을 수 없습니다");
  }
}
