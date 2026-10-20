package com.workplace.calendar.exception;

/** 캘린더 미존재/비소유 — 존재 은닉 위해 404. */
public class CalendarNotFoundException extends RuntimeException {
  public CalendarNotFoundException(long id) {
    // 문구에 id 를 넣지 않는다 — 응답 message 로 그대로 나가 화면·AI 에 내부 번호가 보였다(WP-619)
    super("캘린더를 찾을 수 없습니다");
  }
}
