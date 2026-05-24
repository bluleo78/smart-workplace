package com.workplace.issue.exception;

/** 허용되지 않은 필드 타입 코드. → 400. */
public class InvalidFieldTypeException extends RuntimeException {
  public InvalidFieldTypeException(String type) {
    super("허용되지 않은 필드 타입: " + type);
  }
}
