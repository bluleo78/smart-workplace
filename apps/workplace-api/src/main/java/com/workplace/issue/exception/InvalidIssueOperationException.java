package com.workplace.issue.exception;

/** 비즈니스 규칙 위반(잘못된 상태 전이 등) 시 발생. 422 UNPROCESSABLE_ENTITY 매핑. */
public class InvalidIssueOperationException extends RuntimeException {
  public InvalidIssueOperationException(String message) {
    super(message);
  }
}
