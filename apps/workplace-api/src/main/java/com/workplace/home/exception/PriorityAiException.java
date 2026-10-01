package com.workplace.home.exception;

import com.workplace.global.outbound.AgentOutageGuard;

/** ai-agent 우선순위 분류 요청에 실패(HTTP 오류·타임아웃·빈 응답 등)를 감싸는 예외. */
public class PriorityAiException extends RuntimeException {
  public PriorityAiException(String message, Throwable cause) {
    super(message, cause);
  }

  /** ai-agent 일시 불가(연결·읽기 실패 또는 503)인지 — 판정 규칙은 {@link AgentOutageGuard#isAgentDown}. */
  public boolean isTransient() {
    return AgentOutageGuard.isAgentDown(getCause());
  }
}
