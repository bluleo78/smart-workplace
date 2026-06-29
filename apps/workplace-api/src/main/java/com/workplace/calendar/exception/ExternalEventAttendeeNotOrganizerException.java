package com.workplace.calendar.exception;

/** 동기화로 받은(내가 주최자 아님) 외부 일정의 참석자 변경 시도 — 409. */
public class ExternalEventAttendeeNotOrganizerException extends RuntimeException {
  public ExternalEventAttendeeNotOrganizerException() {
    super("동기화로 받은 일정의 참석자는 변경할 수 없습니다(주최자가 아님).");
  }
}
