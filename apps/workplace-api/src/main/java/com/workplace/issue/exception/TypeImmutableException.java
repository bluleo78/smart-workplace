package com.workplace.issue.exception;

/** 필드 PATCH 에서 type 을 변경 시도. type 은 immutable. → 400. */
public class TypeImmutableException extends RuntimeException {
  public TypeImmutableException() {
    super("필드 타입은 변경할 수 없습니다");
  }
}
