package com.workplace.auth.oauth.dto;

import java.util.Set;

/**
 * 인가 승인·거부 요청 본문(WP-1685) — 인가 요청 파라미터 + 고른 워크스페이스 + 결정. 웹 API 관례대로 camelCase 만 받는다(호출자는 우리 동의
 * 화면(WP-1686)뿐이라 쿼리 이름(snake_case) 별칭을 두지 않는다).
 *
 * @param tenantId 연결할 워크스페이스(ALLOW 때 필수)
 * @param decision {@code ALLOW} 또는 {@code DENY}
 */
public record AuthorizeDecisionRequest(
    String responseType,
    String clientId,
    String redirectUri,
    String codeChallenge,
    String codeChallengeMethod,
    String state,
    String resource,
    Long tenantId,
    String decision) {

  /**
   * 검증에 넘길 인가 요청 파라미터.
   *
   * @param repeated 본문에 두 번 이상 온 인가 요청 파라미터 이름(snake_case)
   */
  public AuthorizeParams params(Set<String> repeated) {
    return new AuthorizeParams(
        responseType,
        clientId,
        redirectUri,
        codeChallenge,
        codeChallengeMethod,
        state,
        resource,
        repeated);
  }
}
