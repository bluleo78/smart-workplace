package com.workplace.calendar.exception;

/** 기본 캘린더는 삭제 불가. */
public class DefaultCalendarDeletionException extends RuntimeException {
  public DefaultCalendarDeletionException() {
    super("기본 캘린더는 삭제할 수 없습니다");
  }
}
