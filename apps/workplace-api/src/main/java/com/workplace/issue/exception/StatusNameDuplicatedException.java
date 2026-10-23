package com.workplace.issue.exception;

/** 같은 프로젝트에 대소문자·앞뒤 공백만 다른 같은 이름의 상태가 이미 있음 — 409. */
public class StatusNameDuplicatedException extends RuntimeException {
  public StatusNameDuplicatedException(String name) {
    super("이미 존재하는 상태 이름입니다: " + name);
  }
}
