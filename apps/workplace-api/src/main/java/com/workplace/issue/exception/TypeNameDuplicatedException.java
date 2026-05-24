package com.workplace.issue.exception;

/** 동일 프로젝트 내 같은 이름의 유형이 이미 존재하는 경우 — 409. */
public class TypeNameDuplicatedException extends RuntimeException {
  public TypeNameDuplicatedException(String name) {
    super("이미 존재하는 유형 이름입니다: " + name);
  }
}
