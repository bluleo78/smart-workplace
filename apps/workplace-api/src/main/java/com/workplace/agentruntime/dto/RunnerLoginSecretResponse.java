package com.workplace.agentruntime.dto;

/**
 * runner 가 받은 AI 의 로그인 정보 원문(WP-1296·1297·1410) — 템플릿이 요구하는 로그인 계정(genia·chatgpt·opencode)과 같은 종류의
 * 활성 연결이다.
 *
 * @param version desired 의 login version 과 같은 값 — genia·chatgpt 는 연결 id, opencode 는 「연결 id + 지정 모델
 *     + 연결 원문」 해시(53비트 양수). 다시 등록하면(opencode 는 모델·원문을 바꿔도) 바뀐다
 * @param provider {@code genia}·{@code chatgpt}·{@code opencode}
 * @param payload genia·chatgpt 는 서버가 다듬어 저장한 로그인 정보 JSON(그 프로그램의 auth.json 내용), opencode 는 OpenAI
 *     호환 연결 원문에 {@code defaultModel} 을 더한 JSON
 */
public record RunnerLoginSecretResponse(long version, String provider, String payload) {

  /** 로그에 원문이 새지 않게 toString 에서 뺀다. */
  @Override
  public String toString() {
    return "RunnerLoginSecretResponse[version=" + version + ", provider=" + provider + "]";
  }
}
