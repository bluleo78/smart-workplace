package com.workplace.fileai.exception;

import com.workplace.global.outbound.AgentOutageGuard;

/** ai-agent 파일 요약 요청 실패(HTTP 오류·타임아웃 등)를 감싸는 예외 — 원인(cause)은 HTTP 클라이언트 예외. */
public class FileAiException extends RuntimeException {
  public FileAiException(String message, Throwable cause) {
    super(message, cause);
  }

  /** ai-agent 일시 불가(연결·읽기 실패 또는 503)인지 — 판정 규칙은 {@link AgentOutageGuard#isAgentDown}. */
  public boolean isAgentDown() {
    return AgentOutageGuard.isAgentDown(getCause());
  }

  /**
   * 요청이 agent 에 닿지도 못했는지(연결 거부·연결 타임아웃·503) — agent 불가 중 읽기 타임아웃만 뺀 것. 읽기 타임아웃은 agent 가 받아 처리하다 늦은
   * 것이라 그 파일의 시도로 센다.
   */
  public boolean isUnreached() {
    return isAgentDown() && !AgentOutageGuard.isReadTimeout(getCause());
  }
}
