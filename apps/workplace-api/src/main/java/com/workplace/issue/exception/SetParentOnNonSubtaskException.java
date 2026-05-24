package com.workplace.issue.exception;

/** setParent 호출 대상이 SUBTASK 가 아닌 경우 — 400. */
public class SetParentOnNonSubtaskException extends RuntimeException {
  public SetParentOnNonSubtaskException() {
    super("SUBTASK 만 부모를 설정할 수 있습니다");
  }
}
