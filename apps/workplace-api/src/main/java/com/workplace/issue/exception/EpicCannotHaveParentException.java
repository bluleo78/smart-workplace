package com.workplace.issue.exception;

/** 에픽에 부모를 지정하려 함 — 400. 문구는 화면 용어(하위 태스크·에픽)로 — 토스트로 그대로 보인다(WP-470). */
public class EpicCannotHaveParentException extends RuntimeException {
  public EpicCannotHaveParentException() {
    super("에픽은 다른 이슈 아래에 둘 수 없습니다");
  }
}
