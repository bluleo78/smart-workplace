package com.workplace.issue.exception;

/** 에픽이 아닌 이슈에 에픽 색을 정하려 함 — 400(WP-1017). 문구는 토스트로 그대로 보인다. */
public class NotAnEpicException extends RuntimeException {
  public NotAnEpicException() {
    super("에픽에만 색을 정할 수 있습니다");
  }
}
