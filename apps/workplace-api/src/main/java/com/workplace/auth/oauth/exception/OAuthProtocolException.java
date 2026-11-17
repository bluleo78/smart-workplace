package com.workplace.auth.oauth.exception;

/**
 * OAuth 프로토콜 오류의 공통 모양(WP-1685) — RFC 오류 코드({@link OAuthErrors})와 사람이 읽는 한국어 설명. 클라이언트 해석·등록, 토큰,
 * 인가 요청 예외가 같은 두 값을 각자 다시 정의하지 않게 한 곳에 둔다. 응답 모양은 이 예외를 받는 컨트롤러가 정한다.
 */
public abstract class OAuthProtocolException extends RuntimeException {

  private final String error;

  protected OAuthProtocolException(String error, String description) {
    super(description);
    this.error = error;
  }

  /** RFC 오류 코드. */
  public String error() {
    return error;
  }

  /** 한국어 오류 설명. */
  public String description() {
    return getMessage();
  }
}
