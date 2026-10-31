package com.workplace.agentruntime.exception;

import org.springframework.http.HttpStatus;

/** 이 AI 에 저장된 실행 설정이 없음(또는 다른 워크스페이스의 것) — 404. */
public class AgentRuntimeSettingNotFoundException extends AgentRuntimeException {
  public AgentRuntimeSettingNotFoundException() {
    super(HttpStatus.NOT_FOUND, "AGENT_RUNTIME_SETTING_NOT_FOUND", "실행 설정이 없습니다");
  }
}
