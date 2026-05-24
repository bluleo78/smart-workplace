package com.workplace.issue.exception;

/** 자기 자신 / 다른 프로젝트 / 없는 이슈 등 의존성 인자 유효성 위반 — 400. */
public class InvalidDependencyException extends RuntimeException {
  /** reason 은 사유 문구(자기 자신/없는 이슈 등). */
  public InvalidDependencyException(String reason) {
    super("의존성 지정이 올바르지 않습니다: " + reason);
  }
}
