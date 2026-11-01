package com.workplace.agentruntime.exception;

import org.springframework.http.HttpStatus;

/**
 * runner 가 비밀값을 받으려는 AI 가 이 위치에서 켜져 있지 않음(WP-1253) — 없는 AI·꺼진 AI·다른 위치·다른 워크스페이스의 AI 를 모두 같은 404 로
 * 돌려 남의 AI 가 있는지 드러내지 않는다.
 */
public class RunnerAgentNotFoundException extends AgentRuntimeException {
  public RunnerAgentNotFoundException() {
    super(HttpStatus.NOT_FOUND, "RUNNER_AGENT_NOT_FOUND", "이 실행 위치에서 켜져 있는 AI 가 아닙니다");
  }
}
