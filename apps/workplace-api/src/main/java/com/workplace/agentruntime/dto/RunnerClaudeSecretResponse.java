package com.workplace.agentruntime.dto;

/**
 * runner 가 받은 AI 의 모델 연결 원문(WP-1253). 관리자가 AI 에 등록한 활성 연결이다.
 *
 * @param version 연결 id(= desired 의 claude version) — 다시 등록하면 바뀐다
 * @param provider {@code anthropic}(payload = 토큰) 또는 {@code opencode}(payload = provider 설정 JSON)
 * @param payload 복호화한 원문
 */
public record RunnerClaudeSecretResponse(long version, String provider, String payload) {

  /** 로그에 원문이 새지 않게 toString 에서 뺀다. */
  @Override
  public String toString() {
    return "RunnerClaudeSecretResponse[version=" + version + ", provider=" + provider + "]";
  }
}
