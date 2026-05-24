package com.workplace.auth.exception;

/** AGENT 유저는 로그인 흐름을 사용할 수 없다 — 키 인증만 허용. 401 매핑. */
public class AgentCannotLoginException extends RuntimeException {
  public AgentCannotLoginException() {
    super("AGENT 유저는 로그인할 수 없습니다");
  }
}
