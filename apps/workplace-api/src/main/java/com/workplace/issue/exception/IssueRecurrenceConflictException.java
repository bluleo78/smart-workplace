package com.workplace.issue.exception;

import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.ResponseStatus;

/** 지금 이 이슈에는 반복을 둘 수 없음(WP-989 — 개인 작업이 아님·담당에 비서 없음·종료된 이슈) → 409. 메시지는 화면에 그대로 보인다. */
@ResponseStatus(HttpStatus.CONFLICT)
public class IssueRecurrenceConflictException extends RuntimeException {
  public IssueRecurrenceConflictException(String message) {
    super(message);
  }
}
