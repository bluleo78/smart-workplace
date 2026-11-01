package com.workplace.agentruntime.exception;

import org.springframework.http.HttpStatus;

/** 상태 보고는 AI 만 한다(WP-1250) — 사람이 부르면 403. */
public class AgentStatusAgentOnlyException extends AgentRuntimeException {
  public AgentStatusAgentOnlyException() {
    super(HttpStatus.FORBIDDEN, "AGENT_STATUS_AGENT_ONLY", "AI 만 상태를 보고할 수 있습니다");
  }
}
