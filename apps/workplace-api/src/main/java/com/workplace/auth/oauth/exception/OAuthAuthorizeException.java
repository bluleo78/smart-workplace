package com.workplace.auth.oauth.exception;

/**
 * 인가 요청 검증·승인 실패(WP-1685). {@code error} 는 RFC 오류 코드({@code invalid_client}·{@code
 * invalid_redirect_uri}·{@code invalid_request}·{@code unsupported_response_type}), {@code
 * description} 은 한국어 설명이다. 공통 두 값에 HTTP 상태와 돌려보낼 주소만 더한다.
 *
 * <p>{@code errorRedirectUrl} 은 클라이언트·redirect_uri 검증을 통과한 뒤의 오류에서만 non-null — 그 전에는 redirect_uri 를
 * 믿을 수 없어 그 주소로 보내면 열린 리다이렉터가 된다(RFC 6749 §4.1.2.1).
 */
public class OAuthAuthorizeException extends OAuthProtocolException {

  private final int status;
  private final String errorRedirectUrl;

  public OAuthAuthorizeException(
      int status, String error, String description, String errorRedirectUrl) {
    super(error, description);
    this.status = status;
    this.errorRedirectUrl = errorRedirectUrl;
  }

  /** HTTP 상태 코드. */
  public int status() {
    return status;
  }

  /** 클라이언트로 오류를 돌려보낼 주소(redirect 를 믿을 수 없는 오류면 null). */
  public String errorRedirectUrl() {
    return errorRedirectUrl;
  }
}
