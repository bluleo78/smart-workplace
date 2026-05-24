package com.workplace.issue.exception;

/** 이슈 유형 정의를 찾을 수 없는 경우 — 404. */
public class TypeNotFoundException extends RuntimeException {
  public TypeNotFoundException(Long id) {
    super("유형을 찾을 수 없습니다: id=" + id);
  }
}
