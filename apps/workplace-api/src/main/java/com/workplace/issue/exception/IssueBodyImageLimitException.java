package com.workplace.issue.exception;

/** 저장 전 임시 본문 이미지 업로드 상한 초과 — HTTP 409 매핑. */
public class IssueBodyImageLimitException extends RuntimeException {
  public IssueBodyImageLimitException(String message) {
    super(message);
  }
}
