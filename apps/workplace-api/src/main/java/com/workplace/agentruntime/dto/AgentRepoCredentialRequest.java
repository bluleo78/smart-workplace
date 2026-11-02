package com.workplace.agentruntime.dto;

/**
 * AI 저장소 토큰 등록 요청(WP-1268). kind·host·token 의 형식 검증은 서비스 한 곳에서 한다(400).
 *
 * @param kind GITHUB 또는 GITLAB
 * @param host 소문자 호스트 이름만(예 github.com) — 입력은 trim+소문자로 맞춘다
 * @param token 토큰 원문(16~2048자)
 */
public record AgentRepoCredentialRequest(String kind, String host, String token) {

  /** 로그에 원문이 새지 않게 toString 에서 뺀다. */
  @Override
  public String toString() {
    return "AgentRepoCredentialRequest[kind=" + kind + ", host=" + host + "]";
  }
}
