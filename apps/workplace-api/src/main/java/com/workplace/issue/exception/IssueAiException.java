package com.workplace.issue.exception;

/** ai-agent 이슈 요약 호출 실패. */
public class IssueAiException extends RuntimeException {
  public IssueAiException(String message, Throwable cause) {
    super(message, cause);
  }
}
