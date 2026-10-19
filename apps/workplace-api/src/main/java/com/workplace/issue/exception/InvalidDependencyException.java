package com.workplace.issue.exception;

/** 자기 자신 / 다른 프로젝트 / 없는 이슈 등 의존성 인자 유효성 위반 — 400. message 는 화면에 그대로 보이는 완성 문장(WP-470). */
public class InvalidDependencyException extends RuntimeException {
  public InvalidDependencyException(String message) {
    super(message);
  }
}
