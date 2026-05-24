package com.workplace.issue.exception;

/** 동일 프로젝트 내 필드 이름 중복. → 409. */
public class FieldNameDuplicatedException extends RuntimeException {
  public FieldNameDuplicatedException(String name) {
    super("이미 존재하는 필드 이름입니다: " + name);
  }
}
