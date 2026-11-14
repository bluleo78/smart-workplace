package com.workplace.issue.exception;

/** 지정한 상태가 이 프로젝트·범주에 맞지 않음(예: 다른 범주의 상태 뒤에 넣기) — 400. */
public class InvalidStatusForProjectException extends RuntimeException {
  /** 기본 문구 — 지정한 상태가 이 프로젝트의 것이 아닐 때. */
  public static final String DEFAULT_MESSAGE = "이 프로젝트의 상태가 아닙니다";

  public InvalidStatusForProjectException() {
    super(DEFAULT_MESSAGE);
  }

  /** 사유를 직접 담는다 — 기본 문구가 사실과 다를 때 원인을 알린다(WP-870 상태 이름 못 찾음, WP-1596 범주 불일치·자기 자신으로 옮김). */
  public InvalidStatusForProjectException(String message) {
    super(message);
  }
}
