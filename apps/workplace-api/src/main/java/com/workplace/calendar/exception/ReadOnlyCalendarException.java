package com.workplace.calendar.exception;

/** 외부 동기화(읽기전용) 컨테이너 소속 캘린더·일정에 대한 로컬 쓰기 시도 — 409. */
public class ReadOnlyCalendarException extends RuntimeException {
  public ReadOnlyCalendarException(long id) {
    // 문구에 id·영문 값을 넣지 않는다 — 응답 message 로 그대로 나가 화면·AI 에 내부 번호가 보였다(WP-672, WP-619 후속)
    super("읽기 전용 캘린더는 수정할 수 없습니다");
  }
}
