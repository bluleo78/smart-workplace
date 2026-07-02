package com.workplace.calendar.exception;

/**
 * 외부 동기화 컨테이너(accountEmail 보유)는 로컬에서 삭제할 수 없다 — 삭제해도 다음 동기화 사이클에서 신규 calendar_id 로 재생성되어 중복/고아 데이터가
 * 발생하므로 방어선으로 409 Conflict.
 */
public class ExternalCalendarDeletionNotAllowedException extends RuntimeException {
  public ExternalCalendarDeletionNotAllowedException(long id) {
    super("외부 동기화 캘린더는 로컬에서 삭제할 수 없습니다: " + id);
  }
}
