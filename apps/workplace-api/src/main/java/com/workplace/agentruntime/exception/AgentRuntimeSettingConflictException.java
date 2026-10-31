package com.workplace.agentruntime.exception;

import org.springframework.http.HttpStatus;

/** 실행 설정 규칙 위반(자리 부족·기본 위치 없음·켜져 있어 지울 수 없음 등) — 409. 메시지는 화면에 그대로 보인다. */
public class AgentRuntimeSettingConflictException extends AgentRuntimeException {
  public AgentRuntimeSettingConflictException(String message) {
    super(HttpStatus.CONFLICT, "AGENT_RUNTIME_SETTING_CONFLICT", message);
  }

  /** Works 가 켜 둔 AI 라 지우거나 「내부」로 바꿀 수 없다 — 설정 삭제와 실행 방식 전환 가드가 같은 문구를 쓴다. */
  public static AgentRuntimeSettingConflictException running() {
    return new AgentRuntimeSettingConflictException("Works 가 실행 중인 AI 입니다. 먼저 끄세요");
  }
}
