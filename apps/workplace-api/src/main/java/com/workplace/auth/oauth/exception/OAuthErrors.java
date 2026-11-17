package com.workplace.auth.oauth.exception;

/**
 * OAuth 오류 코드(WP-1685) — RFC 6749·7591 이 정한 {@code error} 값을 한 곳에 둔다. 인가·등록·토큰 엔드포인트가 같은 값을 따로 정의하다
 * 어긋나지 않게 하려는 것이다. 응답 모양(snake_case·camelCase)은 엔드포인트마다 달라 컨트롤러가 정한다.
 */
public final class OAuthErrors {

  private OAuthErrors() {}

  /** 필수 파라미터 없음·중복·형식 오류·본문이 기대한 형식이 아님(RFC 6749 §4.1.2.1·§5.2). */
  public static final String INVALID_REQUEST = "invalid_request";

  /** 알 수 없는 클라이언트·CIMD 문서를 쓸 수 없음. */
  public static final String INVALID_CLIENT = "invalid_client";

  /** redirect_uri 가 없거나 등록 규칙·등록 목록에 맞지 않음(RFC 7591 §3.2.2). */
  public static final String INVALID_REDIRECT_URI = "invalid_redirect_uri";

  /** 등록 메타데이터(이름·인증 방식·grant 등)가 맞지 않음(RFC 7591 §3.2.2). */
  public static final String INVALID_CLIENT_METADATA = "invalid_client_metadata";

  /** code·refresh 가 없거나 만료·재사용·불일치(redirect_uri·client_id·PKCE)·연결·멤버십이 끊김(RFC 6749 §5.2). */
  public static final String INVALID_GRANT = "invalid_grant";

  /** authorization_code·refresh_token 이 아닌 grant_type(RFC 6749 §5.2). */
  public static final String UNSUPPORTED_GRANT_TYPE = "unsupported_grant_type";

  /** code 가 아닌 response_type(RFC 6749 §4.1.2.1). */
  public static final String UNSUPPORTED_RESPONSE_TYPE = "unsupported_response_type";

  /** 사용자가 동의 화면에서 거부함(RFC 6749 §4.1.2.1). */
  public static final String ACCESS_DENIED = "access_denied";
}
