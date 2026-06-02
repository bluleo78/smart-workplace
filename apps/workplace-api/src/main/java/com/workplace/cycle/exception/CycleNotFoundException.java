package com.workplace.cycle.exception;

/** 사이클이 존재하지 않음 — 404 매핑. */
public class CycleNotFoundException extends RuntimeException {
  public CycleNotFoundException(Long id) {
    super("사이클을 찾을 수 없습니다: id=" + id);
  }
}
