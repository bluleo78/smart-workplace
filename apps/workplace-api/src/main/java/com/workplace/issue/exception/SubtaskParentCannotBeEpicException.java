package com.workplace.issue.exception;

/** 하위 태스크의 부모가 에픽(2단계 초과) — 400. 문구는 화면 용어(하위 태스크·에픽)로 — 토스트로 그대로 보인다(WP-470). */
public class SubtaskParentCannotBeEpicException extends RuntimeException {
  public SubtaskParentCannotBeEpicException() {
    super("하위 태스크는 에픽 바로 아래에 둘 수 없습니다. 에픽 안의 태스크·버그 아래에 만들어 주세요");
  }
}
