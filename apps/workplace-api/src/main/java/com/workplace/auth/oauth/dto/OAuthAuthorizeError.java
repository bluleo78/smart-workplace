package com.workplace.auth.oauth.dto;

import com.fasterxml.jackson.annotation.JsonInclude;

/**
 * 인가 요청 검증·승인 오류 본문(WP-1685) — 동의 화면(웹)이 읽는 camelCase 모양. {@code errorRedirectUrl} 은 클라이언트와
 * redirect_uri 를 믿을 수 있게 된 뒤의 오류에만 있고(웹이 그 주소로 보낸다, RFC 6749 §4.1.2.1), 그 전 오류(invalid_client·
 * invalid_redirect_uri)에는 아예 싣지 않는다 — 열린 리다이렉터가 되지 않게.
 */
@JsonInclude(JsonInclude.Include.NON_NULL)
public record OAuthAuthorizeError(String error, String errorDescription, String errorRedirectUrl) {}
