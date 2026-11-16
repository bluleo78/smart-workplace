package com.workplace.issue.exception;

/**
 * 본문 이미지 업로드 거부(빈 파일·크기 초과·이미지 형식 아님) — HTTP 400 매핑. 본문 파일 자리표시(WP-1634)를 못 쓸 때(남의·없는·만료·이미 붙인 파일,
 * 크기 초과 이미지, 바꾼 본문의 길이 초과)도 같은 400 으로 문구를 그대로 돌려준다.
 */
public class IssueBodyImageRejectedException extends RuntimeException {
  public IssueBodyImageRejectedException(String message) {
    super(message);
  }
}
