package com.workplace.cycle.exception;

/** 허용되지 않은 사이클 상태 — 400 매핑. */
public class InvalidCycleStatusException extends RuntimeException {
  public InvalidCycleStatusException(String status) {
    super("허용되지 않은 사이클 상태: " + status);
  }
}
