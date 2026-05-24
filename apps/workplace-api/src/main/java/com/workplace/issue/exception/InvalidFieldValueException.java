package com.workplace.issue.exception;

/** 필드 값 모양 또는 options 화이트리스트 위반. → 400. */
public class InvalidFieldValueException extends RuntimeException {
  public InvalidFieldValueException(String reason) {
    super("필드 값 오류: " + reason);
  }
}
