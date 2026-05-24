package com.workplace.issue.exception;

/** 부모 지정이 잘못됨 — 존재하지 않거나 다른 프로젝트, 자기 자신 등. 400. */
public class InvalidParentException extends RuntimeException {
  public InvalidParentException(String reason) {
    super("부모 지정이 올바르지 않습니다: " + reason);
  }
}
