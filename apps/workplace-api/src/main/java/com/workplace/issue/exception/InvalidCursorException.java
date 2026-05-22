package com.workplace.issue.exception;

/** 잘못된 검색 cursor — 400 매핑. */
public class InvalidCursorException extends RuntimeException {
  public InvalidCursorException(String message) {
    super(message);
  }
}
