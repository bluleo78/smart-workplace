package com.workplace.issue.exception;

/** SUBTASK 의 부모로 EPIC 을 지정 — 2단계 초과 계층 금지. 400. */
public class SubtaskParentCannotBeEpicException extends RuntimeException {
  public SubtaskParentCannotBeEpicException() {
    super("SUBTASK 는 EPIC 을 부모로 가질 수 없습니다 (2단계 초과 금지)");
  }
}
