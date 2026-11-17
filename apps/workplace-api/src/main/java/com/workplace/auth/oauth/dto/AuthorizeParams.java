package com.workplace.auth.oauth.dto;

import java.util.Set;

/**
 * 인가 요청 파라미터(WP-1685) — 동의 화면이 커넥터가 보낸 {@code /oauth/authorize} 쿼리를 그대로 옮겨 검증·승인 API 에 넘긴다. 검증 전
 * 값이라 모두 null 일 수 있다. {@code scope} 는 받지 않는다(범위 없음 — 설계 밖).
 *
 * @param repeated 두 번 이상 온 파라미터의 쿼리 이름(snake_case, 예: {@code client_id}) — RFC 6749 §3.1 은 같은 파라미터를
 *     두 번 보내지 못하게 하므로 검증이 {@code invalid_request} 로 거절한다. 없으면 빈 집합
 */
public record AuthorizeParams(
    String responseType,
    String clientId,
    String redirectUri,
    String codeChallenge,
    String codeChallengeMethod,
    String state,
    String resource,
    Set<String> repeated) {

  public AuthorizeParams {
    repeated = repeated == null ? Set.of() : Set.copyOf(repeated);
  }

  /** state 만 바꾼 같은 요청 — 겹친 state 를 오류 redirect 에서 뺄 때(null) 쓴다. */
  public AuthorizeParams withState(String newState) {
    return new AuthorizeParams(
        responseType,
        clientId,
        redirectUri,
        codeChallenge,
        codeChallengeMethod,
        newState,
        resource,
        repeated);
  }

  /** resource 만 바꾼 같은 요청 — 빈 resource 를 없는 것(null)으로 다듬을 때 쓴다. */
  public AuthorizeParams withResource(String newResource) {
    return new AuthorizeParams(
        responseType,
        clientId,
        redirectUri,
        codeChallenge,
        codeChallengeMethod,
        state,
        newResource,
        repeated);
  }
}
