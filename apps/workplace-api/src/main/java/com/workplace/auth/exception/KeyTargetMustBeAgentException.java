package com.workplace.auth.exception;

/** API 키는 AGENT 유저에게만 발급/조회/회수할 수 있다 — HUMAN 대상 요청 시 400. */
public class KeyTargetMustBeAgentException extends RuntimeException {
  public KeyTargetMustBeAgentException() {
    super("API 키는 AGENT 유저에게만 발급할 수 있습니다");
  }
}
