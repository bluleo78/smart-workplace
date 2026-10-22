package com.workplace.issue.exception;

/** 지정한 상태가 이 프로젝트·범주에 맞지 않음(예: 다른 범주의 상태 뒤에 넣기) — 400. */
public class InvalidStatusForProjectException extends RuntimeException {
  public InvalidStatusForProjectException() {
    super("이 프로젝트의 상태가 아닙니다");
  }
}
