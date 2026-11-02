package com.workplace.agentruntime.exception;

import org.springframework.http.HttpStatus;

/**
 * 워크스페이스를 밝혀야 답할 수 있는 AI 조회(WP-1275 맡는 프로젝트)를 여러 워크스페이스에 속한 AI 가 워크스페이스 없이 부르면 400. 빈 목록으로 답하면 부른
 * 쪽(작업 공간·start-agent·알림 감시)이 「맡은 프로젝트 없음」과 구분하지 못해 칸을 띄우지 않고 그냥 넘어간다.
 */
public class AgentWorkspaceRequiredException extends AgentRuntimeException {
  public AgentWorkspaceRequiredException() {
    super(
        HttpStatus.BAD_REQUEST,
        "AGENT_WORKSPACE_REQUIRED",
        "여러 워크스페이스에 속한 AI 는 워크스페이스를 밝혀야 합니다(GENIA_WORKS_TENANT)");
  }
}
