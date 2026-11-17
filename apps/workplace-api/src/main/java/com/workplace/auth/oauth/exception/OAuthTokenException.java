package com.workplace.auth.oauth.exception;

/**
 * 토큰 엔드포인트 실패(WP-1685). {@code error} 는 RFC 6749 §5.2 오류 코드({@link
 * OAuthErrors#INVALID_REQUEST}·{@link OAuthErrors#INVALID_GRANT}·{@link
 * OAuthErrors#UNSUPPORTED_GRANT_TYPE})다. 컨트롤러가 400 + {@code
 * {"error","error_description"}}(snake_case)로 바꾼다.
 */
public class OAuthTokenException extends OAuthProtocolException {

  public OAuthTokenException(String error, String description) {
    super(error, description);
  }
}
