package com.workplace.issue.exception;

/** 하위 태스크를 부모로 지정하려 함 — 400. 문구는 화면 용어(하위 태스크·에픽)로 — 토스트로 그대로 보인다(WP-470). */
public class ParentCannotBeSubtaskException extends RuntimeException {
  public ParentCannotBeSubtaskException() {
    super("하위 태스크 아래에는 다른 이슈를 둘 수 없습니다");
  }
}
