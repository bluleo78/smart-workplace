package com.workplace.issue.exception;

/**
 * 이슈 검색 필터 값을 해석할 수 없음 — 400 매핑(#841).
 *
 * <p>예전에는 해석 불가 토큰(라벨·유형 이름, username 등)을 조용히 버려 필터가 빠진 결과를 정답처럼 반환했다. 이제는 어떤 필드의 어떤 값이 문제인지와 사용
 * 가능한 값을 담아 거부한다. {@link #field} 는 ErrorResponse.errors 의 키가 되어 AI 도구가 필드 단위로 자가교정할 수 있다.
 */
public class InvalidIssueFilterException extends RuntimeException {

  private final String field;

  public InvalidIssueFilterException(String field, String message) {
    super(message);
    this.field = field;
  }

  public String getField() {
    return field;
  }
}
