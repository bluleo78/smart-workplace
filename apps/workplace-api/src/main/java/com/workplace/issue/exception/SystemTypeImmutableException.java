package com.workplace.issue.exception;

/** 시스템 유형(TASK/BUG/STORY/CHORE) 수정/삭제 시도 — 409. */
public class SystemTypeImmutableException extends RuntimeException {
  public SystemTypeImmutableException() {
    super("시스템 유형은 수정/삭제할 수 없습니다");
  }
}
