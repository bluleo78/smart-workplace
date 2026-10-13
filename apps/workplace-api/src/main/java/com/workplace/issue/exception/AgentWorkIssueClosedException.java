package com.workplace.issue.exception;

import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.ResponseStatus;

/** 완료·취소된 이슈에는 AI 작업을 보고할 수 없다 → 409. */
@ResponseStatus(HttpStatus.CONFLICT)
public class AgentWorkIssueClosedException extends RuntimeException {
  public AgentWorkIssueClosedException() {
    super("Issue is closed");
  }
}
