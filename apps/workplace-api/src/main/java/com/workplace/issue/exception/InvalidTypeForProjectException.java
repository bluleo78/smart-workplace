package com.workplace.issue.exception;

/** 다른 프로젝트에 속한 유형 id 를 지정 — 400. */
public class InvalidTypeForProjectException extends RuntimeException {
  public InvalidTypeForProjectException() {
    super("프로젝트에 속하지 않은 유형입니다");
  }
}
