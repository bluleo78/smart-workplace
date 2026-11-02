package com.workplace.agentruntime.exception;

import org.springframework.http.HttpStatus;

/** 폐기하려는 저장소 토큰이 그 AI 의 활성 토큰이 아님(WP-1268) — 없는 id·이미 폐기·다른 AI 의 것을 모두 같은 404 로. */
public class AgentRepoCredentialNotFoundException extends AgentRuntimeException {
  public AgentRepoCredentialNotFoundException() {
    super(HttpStatus.NOT_FOUND, "AGENT_REPO_CREDENTIAL_NOT_FOUND", "저장소 토큰을 찾을 수 없습니다");
  }
}
