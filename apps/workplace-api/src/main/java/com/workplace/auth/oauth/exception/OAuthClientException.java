package com.workplace.auth.oauth.exception;

/**
 * OAuth 클라이언트 해석·등록 실패(WP-1685). {@code error} 는 {@link OAuthErrors#INVALID_CLIENT}·{@link
 * OAuthErrors#INVALID_REDIRECT_URI}·{@link OAuthErrors#INVALID_CLIENT_METADATA} 중 하나다. 응답 모양(등록은
 * snake_case, 동의 화면 검증은 camelCase)은 엔드포인트마다 달라 이 예외를 받는 컨트롤러가 정한다.
 */
public class OAuthClientException extends OAuthProtocolException {

  public OAuthClientException(String error, String description) {
    super(error, description);
  }
}
