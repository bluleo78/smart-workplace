package com.workplace.issue.exception;

/** ai-agent 이슈 요약 호출 실패. */
public class IssueAiException extends RuntimeException {
  public IssueAiException(String message, Throwable cause) {
    super(message, cause);
  }

  /** 원인 예외 없이 끝낼 때 — 연동이 꺼져 있어 부르지 않은 경우(WP-1639) 등. */
  public IssueAiException(String message) {
    super(message);
  }
}
