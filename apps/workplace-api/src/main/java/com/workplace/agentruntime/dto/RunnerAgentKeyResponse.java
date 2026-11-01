package com.workplace.agentruntime.dto;

import java.time.OffsetDateTime;

/**
 * runner 가 받은 AI 키(WP-1253) — 평문은 이 응답으로만 한 번 나간다. runner 는 Pod 의 Secret 에 담고, desired 의 agent-key
 * version 이 keyId 와 다르거나 rotateAfter 가 지나면 다시 받는다.
 *
 * @param keyId 키 id(= desired 의 agent-key version)
 * @param plaintext {@code ak_…} 평문
 * @param expiresAt 만료 시각(발급 + 30일)
 * @param rotateAfter 이 시각이 지나면 새 키를 받는다(만료 − 7일)
 */
public record RunnerAgentKeyResponse(
    long keyId, String plaintext, OffsetDateTime expiresAt, OffsetDateTime rotateAfter) {

  /** 로그에 평문이 새지 않게 toString 에서 뺀다. */
  @Override
  public String toString() {
    return "RunnerAgentKeyResponse[keyId=" + keyId + ", expiresAt=" + expiresAt + "]";
  }
}
