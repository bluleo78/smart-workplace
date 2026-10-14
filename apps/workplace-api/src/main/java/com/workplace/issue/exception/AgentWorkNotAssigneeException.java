package com.workplace.issue.exception;

import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.ResponseStatus;

/** 담당자가 아닌 사용자가 AI 작업을 보고했다 → 403. */
@ResponseStatus(HttpStatus.FORBIDDEN)
public class AgentWorkNotAssigneeException extends RuntimeException {
  public AgentWorkNotAssigneeException() {
    super("Only an assignee can report work on this issue");
  }
}
