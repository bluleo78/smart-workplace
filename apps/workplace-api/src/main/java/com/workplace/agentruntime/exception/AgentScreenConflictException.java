package com.workplace.agentruntime.exception;

import org.springframework.http.HttpStatus;

/** 작업 화면을 열 수 없는 상태(실행 중이 아님·열린 화면 수 초과 등, WP-1277) — 409. 메시지는 화면에 그대로 보인다. */
public class AgentScreenConflictException extends AgentRuntimeException {
  public AgentScreenConflictException(String message) {
    super(HttpStatus.CONFLICT, "AGENT_SCREEN_CONFLICT", message);
  }
}
