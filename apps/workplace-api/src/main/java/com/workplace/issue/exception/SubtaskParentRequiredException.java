package com.workplace.issue.exception;

/** 하위 태스크인데 부모 번호가 없음 — 400. 문구는 화면 용어(하위 태스크·에픽)로 — 토스트로 그대로 보인다(WP-470). */
public class SubtaskParentRequiredException extends RuntimeException {
  public SubtaskParentRequiredException() {
    super("하위 태스크는 부모 이슈 번호가 필요합니다");
  }
}
