package com.workplace.issue.exception;

/** 비SUBTASK 생성에 parentNumber 가 지정된 경우 — 400. */
public class ParentNotAllowedException extends RuntimeException {
  public ParentNotAllowedException() {
    super("SUBTASK 가 아닌 이슈는 부모를 가질 수 없습니다");
  }
}
