package com.workplace.calendar.exception;

/** 외부 동기화 일정의 인앱 RSVP 시도 — 409(역전송 미지원, 다음 sync 가 덮어씀). */
public class ExternalEventRsvpNotSupportedException extends RuntimeException {
  public ExternalEventRsvpNotSupportedException() {
    super("외부 캘린더 일정의 참석 여부는 원본(예: Outlook)에서 응답해야 합니다.");
  }
}
