package com.workplace.user.exception;

/**
 * 에이전트 실행 방식(runtime) 규칙 위반 (409, WP-371). 공통 비서·개인 비서는 AI Chat 이 서버 실행을 전제로 하므로 EXTERNAL 로 바꾸거나,
 * EXTERNAL 에이전트를 공통 비서로 지정할 수 없다.
 */
public class AgentRuntimeConflictException extends RuntimeException {
  public AgentRuntimeConflictException(String message) {
    super(message);
  }
}
