package com.workplace.agentruntime.exception;

import org.springframework.http.HttpStatus;

/** 실행 위치 규칙 위반(이름 중복·기본 위치 삭제 등) — 409. 메시지는 화면에 그대로 보인다. */
public class AgentLocationConflictException extends AgentRuntimeException {
  public AgentLocationConflictException(String message) {
    super(HttpStatus.CONFLICT, "AGENT_LOCATION_CONFLICT", message);
  }

  /** 같은 워크스페이스에 같은 이름의 위치가 이미 있다 — 미리 확인과 유니크 위반 두 곳에서 같은 문구를 쓰려고 둔다. */
  public static AgentLocationConflictException nameTaken() {
    return new AgentLocationConflictException("같은 이름의 실행 위치가 이미 있습니다");
  }
}
