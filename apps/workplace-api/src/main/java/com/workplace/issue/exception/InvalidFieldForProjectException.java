package com.workplace.issue.exception;

/** PUT values 에 다른 프로젝트의 필드 defId 가 섞임. → 400. */
public class InvalidFieldForProjectException extends RuntimeException {
  public InvalidFieldForProjectException() {
    super("프로젝트에 속하지 않은 필드입니다");
  }
}
