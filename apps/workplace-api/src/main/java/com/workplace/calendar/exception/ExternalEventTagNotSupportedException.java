package com.workplace.calendar.exception;

import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.ResponseStatus;

/**
 * 외부(M365) 동기화 일정에 앱에서 태그 붙이기 시도(WP-714) — 409. 이 일정의 태그는 Outlook 범주에서 오고 다음 동기화가 덮으므로, 범주 써
 * 넣기(WP-716)가 생기기 전까지는 막는다.
 */
@ResponseStatus(HttpStatus.CONFLICT)
public class ExternalEventTagNotSupportedException extends RuntimeException {
  public ExternalEventTagNotSupportedException() {
    super("Outlook 일정의 태그는 Outlook 범주에서 바꿀 수 있습니다");
  }
}
