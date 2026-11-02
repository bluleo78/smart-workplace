package com.workplace.agentruntime.exception;

import org.springframework.http.HttpStatus;

/** AI 키({@code ak_})로만 부르는 API(WP-1250 상태 보고·WP-1275 맡는 프로젝트)를 사람이 부르면 403. */
public class AgentOnlyException extends AgentRuntimeException {
  private AgentOnlyException(String code, String message) {
    super(HttpStatus.FORBIDDEN, code, message);
  }

  /** 상태 보고 — 코드는 계약 문서(agent-runner-api.md)에 적힌 그대로. */
  public static AgentOnlyException forStatusReport() {
    return new AgentOnlyException("AGENT_STATUS_AGENT_ONLY", "AI 만 상태를 보고할 수 있습니다");
  }

  /** 맡는 프로젝트 조회. */
  public static AgentOnlyException forProjects() {
    return new AgentOnlyException("AGENT_PROJECTS_AGENT_ONLY", "AI 만 맡는 프로젝트를 조회할 수 있습니다");
  }
}
