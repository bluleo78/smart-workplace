package com.workplace.view.exception;

/** 같은 사용자/프로젝트 내 뷰 이름 중복 — 409 매핑. */
public class SavedViewNameDuplicatedException extends RuntimeException {
  public SavedViewNameDuplicatedException(String name) {
    super("이미 존재하는 뷰 이름입니다: " + name);
  }
}
