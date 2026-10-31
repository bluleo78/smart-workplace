package com.workplace.agentruntime.exception;

import org.springframework.http.HttpStatus;

/** 이름으로 찾은 실행 템플릿이 없음 — 404. */
public class AgentTemplateNotFoundException extends AgentRuntimeException {
  public AgentTemplateNotFoundException() {
    // 이름을 문구에 넣지 않는다 — 응답 message 가 그대로 화면에 나간다(WP-619 와 같은 방침).
    super(HttpStatus.NOT_FOUND, "AGENT_TEMPLATE_NOT_FOUND", "실행 템플릿을 찾을 수 없습니다");
  }
}
