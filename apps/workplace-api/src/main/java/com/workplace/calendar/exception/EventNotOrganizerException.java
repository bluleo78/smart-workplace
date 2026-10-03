package com.workplace.calendar.exception;

/**
 * 주최자가 아닌 사용자의 일정 수정·삭제 시도 — 403(WP-200).
 *
 * <p>다른 사람이 주최한 미팅은 내 캘린더(동기화 사본)에 있어도 수정·삭제할 수 없다. 참석자는 응답(RSVP)만 바꿀 수 있다.
 */
public class EventNotOrganizerException extends RuntimeException {
  public EventNotOrganizerException() {
    super("다른 사람이 주최한 일정은 주최자만 수정하거나 삭제할 수 있습니다.");
  }
}
