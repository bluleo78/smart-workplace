package com.workplace.cycle.exception;

/** 같은 프로젝트 내 사이클 이름 중복 — 409 매핑. */
public class CycleNameDuplicatedException extends RuntimeException {
  public CycleNameDuplicatedException(String name) {
    super("이미 존재하는 사이클 이름입니다: " + name);
  }
}
