package com.workplace.cycle.exception;

/** 종료일이 시작일보다 빠른 사이클 생성/수정 시도 — 400 매핑. */
public class InvalidCycleDateRangeException extends RuntimeException {
  public InvalidCycleDateRangeException() {
    super("종료일은 시작일 이후여야 합니다");
  }
}
