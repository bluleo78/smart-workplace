package com.workplace.issue.exception;

/** 개인 프로젝트는 기본 4상태로 고정 — 상태 추가·이름 변경 시도는 400. */
public class StatusEditNotSupportedException extends RuntimeException {
  public StatusEditNotSupportedException() {
    super("개인 프로젝트는 상태를 편집할 수 없습니다");
  }
}
