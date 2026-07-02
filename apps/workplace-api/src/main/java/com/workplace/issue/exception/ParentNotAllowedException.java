package com.workplace.issue.exception;

/** 일반 이슈(비SUBTASK, 비EPIC)가 부모로 EPIC 이 아닌 이슈를 지정한 경우 — 400. */
public class ParentNotAllowedException extends RuntimeException {
  public ParentNotAllowedException() {
    super("일반 이슈는 EPIC 만 부모로 지정할 수 있습니다");
  }
}
