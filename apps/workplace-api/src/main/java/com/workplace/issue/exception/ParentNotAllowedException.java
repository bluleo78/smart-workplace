package com.workplace.issue.exception;

/** 일반 이슈의 부모가 에픽이 아님 — 400. 문구는 화면 용어(하위 태스크·에픽)로 — 토스트로 그대로 보인다(WP-470). */
public class ParentNotAllowedException extends RuntimeException {
  public ParentNotAllowedException() {
    super("일반 이슈는 에픽 아래에만 둘 수 있습니다");
  }
}
