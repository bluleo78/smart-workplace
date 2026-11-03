package com.workplace.agentruntime.dto;

/**
 * runner 가 받은 AI 의 로그인 정보 원문(WP-1296·1297) — 템플릿이 요구하는 로그인 계정(genia·chatgpt)과 같은 종류의 활성 연결이다.
 *
 * @param version 연결 id(= desired 의 login version) — 다시 등록하면 바뀐다
 * @param provider {@code genia} 또는 {@code chatgpt}
 * @param payload 서버가 다듬어 저장한 로그인 정보 JSON(그 프로그램의 auth.json 내용)
 */
public record RunnerLoginSecretResponse(long version, String provider, String payload) {

  /** 로그에 원문이 새지 않게 toString 에서 뺀다. */
  @Override
  public String toString() {
    return "RunnerLoginSecretResponse[version=" + version + ", provider=" + provider + "]";
  }
}
