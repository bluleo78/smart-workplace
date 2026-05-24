package com.workplace.issue.exception;

/** 이슈가 사용 중인 CUSTOM 유형 삭제 시도 — 409. */
public class TypeInUseException extends RuntimeException {
  public TypeInUseException(int count) {
    super("사용 중인 유형은 삭제할 수 없습니다 (이슈 " + count + "개)");
  }
}
