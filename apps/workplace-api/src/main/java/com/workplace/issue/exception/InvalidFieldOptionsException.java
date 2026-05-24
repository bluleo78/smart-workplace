package com.workplace.issue.exception;

/** SELECT/MULTI_SELECT options 누락/형식 오류 또는 비-SELECT 타입에 options 지정. → 400. */
public class InvalidFieldOptionsException extends RuntimeException {
  public InvalidFieldOptionsException(String reason) {
    super("필드 옵션 오류: " + reason);
  }
}
