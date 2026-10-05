package com.workplace.fileai.exception;

/** 구간 읽기 offset 음수 또는 limit 1 미만 — 400(WP-242). */
public class InvalidTextRangeException extends RuntimeException {
  public InvalidTextRangeException(String message) {
    super(message);
  }
}
