package com.workplace.calendar.exception;

/** 외부 동기화(읽기전용) 컨테이너 소속 캘린더·일정에 대한 로컬 쓰기 시도 — 409. */
public class ReadOnlyCalendarException extends RuntimeException {
  public ReadOnlyCalendarException(long id) {
    super("읽기전용 캘린더는 수정할 수 없습니다: " + id);
  }
}
