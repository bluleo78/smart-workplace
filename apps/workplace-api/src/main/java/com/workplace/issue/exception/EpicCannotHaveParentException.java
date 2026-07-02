package com.workplace.issue.exception;

/** EPIC 은 부모를 가질 수 없음(최상위 컨테이너) — 400. */
public class EpicCannotHaveParentException extends RuntimeException {
  public EpicCannotHaveParentException() {
    super("EPIC 은 부모를 가질 수 없습니다");
  }
}
