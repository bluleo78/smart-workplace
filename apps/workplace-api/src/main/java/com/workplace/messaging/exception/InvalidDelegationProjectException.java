package com.workplace.messaging.exception;

/** 승인 override 프로젝트가 위임 후보 밖 — 400. */
public class InvalidDelegationProjectException extends RuntimeException {

  public InvalidDelegationProjectException(String key) {
    super("위임 후보 프로젝트가 아닙니다: " + key);
  }
}
