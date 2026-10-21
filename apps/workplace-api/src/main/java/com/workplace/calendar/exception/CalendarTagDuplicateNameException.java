package com.workplace.calendar.exception;

import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.ResponseStatus;

/** 같은 이름(대소문자 무시)의 태그가 이미 있음(WP-714) — 409. Outlook 범주 이름과 1:1 로 맞추려고 이름을 사용자 안에서 유일하게 둔다. */
@ResponseStatus(HttpStatus.CONFLICT)
public class CalendarTagDuplicateNameException extends RuntimeException {
  public CalendarTagDuplicateNameException() {
    super("같은 이름의 태그가 이미 있습니다");
  }
}
