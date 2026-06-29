package com.workplace.calendar.exception;

/** 외부(M365) 동기화 일정은 다른 캘린더로 이동할 수 없다 — 시도 시 422. 캘린더 간 이동은 Graph 별도 move API(범위 밖). */
public class ExternalEventMoveNotSupportedException extends RuntimeException {
  public ExternalEventMoveNotSupportedException() {
    super("동기화된 일정은 다른 캘린더로 이동할 수 없습니다.");
  }
}
