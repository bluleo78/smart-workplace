package com.workplace.cycle.exception;

/** 이슈가 속한 프로젝트가 아닌 사이클에 연결하려 했을 때 — 400 매핑. */
public class InvalidCycleForProjectException extends RuntimeException {
  public InvalidCycleForProjectException() {
    super("이슈와 다른 프로젝트의 사이클에는 연결할 수 없습니다");
  }
}
