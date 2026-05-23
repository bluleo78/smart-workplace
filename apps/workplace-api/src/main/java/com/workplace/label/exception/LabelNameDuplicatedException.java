package com.workplace.label.exception;

/** 같은 프로젝트 내 라벨 이름 중복 — 409 매핑. */
public class LabelNameDuplicatedException extends RuntimeException {
  public LabelNameDuplicatedException(String name) {
    super("이미 존재하는 라벨 이름입니다: " + name);
  }
}
