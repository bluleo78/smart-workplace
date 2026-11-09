package com.workplace.agentruntime.exception;

import org.springframework.http.HttpStatus;

/** Pod 가 받거나 올릴 묶인 로그인 계정이 없음(WP-1450) — 묶인 chatgpt·genia 계정 없음·폐기·템플릿과 안 맞음. 404. */
public class AgentLoginNotFoundException extends AgentRuntimeException {
  public AgentLoginNotFoundException() {
    super(HttpStatus.NOT_FOUND, "AGENT_LOGIN_NOT_FOUND", "AI 에 묶인 로그인 계정이 없습니다");
  }
}
