package com.workplace.issue.exception;

/** 프로젝트 상태가 이미 상한(20개)이라 더 추가할 수 없음 — 409 (WP-811). 보드 컬럼이 감당할 수 있는 수로 묶어 둔다. */
public class StatusLimitExceededException extends RuntimeException {
  public StatusLimitExceededException() {
    super("상태는 프로젝트당 20개까지 만들 수 있어요");
  }
}
