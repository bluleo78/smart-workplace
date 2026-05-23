package com.workplace.issue.exception;

/** 다른 프로젝트의 사용자 또는 멤버가 아닌 사용자를 담당자로 지정 시도 — 400. */
public class InvalidAssigneeForProjectException extends RuntimeException {
  public InvalidAssigneeForProjectException() {
    super("프로젝트 멤버만 담당자로 지정할 수 있습니다");
  }
}
