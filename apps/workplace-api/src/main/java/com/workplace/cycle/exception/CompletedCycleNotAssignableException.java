package com.workplace.cycle.exception;

/** 완료(COMPLETED)된 사이클로 이슈를 옮기려 했을 때 — 400 매핑. 사이클 페이지 드래그 이동(#881)에서 차단. */
public class CompletedCycleNotAssignableException extends RuntimeException {
  public CompletedCycleNotAssignableException() {
    super("완료된 사이클에는 이슈를 추가할 수 없습니다");
  }
}
