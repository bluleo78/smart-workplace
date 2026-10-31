package com.workplace.agentruntime.exception;

import org.springframework.http.HttpStatus;

/** 실행 위치가 없거나 이 워크스페이스의 것이 아님 — 404. */
public class AgentLocationNotFoundException extends AgentRuntimeException {
  public AgentLocationNotFoundException() {
    // id 를 문구에 넣지 않는다 — 응답 message 가 그대로 화면에 나간다(WP-619 와 같은 방침).
    super(HttpStatus.NOT_FOUND, "AGENT_LOCATION_NOT_FOUND", "실행 위치를 찾을 수 없습니다");
  }
}
