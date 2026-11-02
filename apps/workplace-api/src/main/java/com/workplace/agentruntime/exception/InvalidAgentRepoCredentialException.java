package com.workplace.agentruntime.exception;

import org.springframework.http.HttpStatus;

/** AI 저장소 토큰 등록 요청이 맞지 않음(WP-1268) — 400. kind·host·token 형식 위반. 메시지에 토큰 값을 싣지 않는다. */
public class InvalidAgentRepoCredentialException extends AgentRuntimeException {
  public InvalidAgentRepoCredentialException(String message) {
    super(HttpStatus.BAD_REQUEST, "AGENT_REPO_CREDENTIAL_INVALID", message);
  }
}
