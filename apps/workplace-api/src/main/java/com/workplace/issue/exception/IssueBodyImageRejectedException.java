package com.workplace.issue.exception;

/** 본문 이미지 업로드 거부(빈 파일·크기 초과·이미지 형식 아님) — HTTP 400 매핑. */
public class IssueBodyImageRejectedException extends RuntimeException {
  public IssueBodyImageRejectedException(String message) {
    super(message);
  }
}
