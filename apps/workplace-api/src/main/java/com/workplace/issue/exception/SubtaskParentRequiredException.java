package com.workplace.issue.exception;

/** SUBTASK 생성에 parentNumber 가 누락된 경우 — 400. */
public class SubtaskParentRequiredException extends RuntimeException {
  public SubtaskParentRequiredException() {
    super("SUBTASK 생성에는 parentNumber 가 필요합니다");
  }
}
