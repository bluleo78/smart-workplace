package com.workplace.agentruntime.exception;

import org.springframework.http.HttpStatus;

/** runner 가 받으려는 비밀값이 Works 에 없음(WP-1253 — 예: AI 에 Claude 연결이 등록되지 않음) — 404. */
public class RunnerSecretNotFoundException extends AgentRuntimeException {
  public RunnerSecretNotFoundException(String message) {
    super(HttpStatus.NOT_FOUND, "RUNNER_SECRET_NOT_FOUND", message);
  }
}
