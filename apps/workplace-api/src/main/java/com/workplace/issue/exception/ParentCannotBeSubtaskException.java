package com.workplace.issue.exception;

/** parent 의 type 이 SUBTASK 인 경우 — 1단계 트리만 허용. 400. */
public class ParentCannotBeSubtaskException extends RuntimeException {
  public ParentCannotBeSubtaskException() {
    super("SUBTASK 는 다른 이슈의 부모가 될 수 없습니다");
  }
}
