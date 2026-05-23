package com.workplace.label.exception;

/** 이슈가 속한 프로젝트가 아닌 라벨을 부착하려 했을 때 — 400 매핑. */
public class InvalidLabelForProjectException extends RuntimeException {
  public InvalidLabelForProjectException() {
    super("이슈와 다른 프로젝트의 라벨은 부착할 수 없습니다");
  }
}
