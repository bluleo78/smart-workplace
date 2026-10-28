package com.workplace.issue.exception;

import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.ResponseStatus;

/** 반복 규칙·시각 형식이 허용 범위 밖(WP-989) → 400. 메시지는 화면에 그대로 보이는 한국어 사유다. */
@ResponseStatus(HttpStatus.BAD_REQUEST)
public class InvalidIssueRecurrenceException extends RuntimeException {
  public InvalidIssueRecurrenceException(String message) {
    super(message);
  }
}
