package com.workplace.issue.exception;

/** 부모 지정이 잘못됨 — 존재하지 않거나 다른 프로젝트, 자기 자신 등. 400. message 는 화면에 그대로 보이는 완성 문장(WP-470). */
public class InvalidParentException extends RuntimeException {
  public InvalidParentException(String message) {
    super(message);
  }
}
