package com.workplace.agentruntime.exception;

import org.springframework.http.HttpStatus;

/**
 * AI 실행 설정 요청이 맞지 않음 — 400. 설정 값이 템플릿 정의에 맞지 않거나(모르는 칸·선택지 밖 값·빈 필수 칸), 템플릿이 작업 공간 템플릿이 아니거나, 대상이
 * AI 가 아닐 때. 메시지는 화면에 그대로 보인다.
 */
public class InvalidAgentConfigException extends AgentRuntimeException {
  public InvalidAgentConfigException(String message) {
    super(HttpStatus.BAD_REQUEST, "AGENT_CONFIG_INVALID", message);
  }
}
