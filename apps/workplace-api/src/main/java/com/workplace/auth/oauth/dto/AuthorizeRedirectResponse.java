package com.workplace.auth.oauth.dto;

/**
 * 인가 승인·거부 응답(WP-1685) — 웹이 브라우저를 보낼 클라이언트 redirect 주소. 승인이면 {@code code}·{@code state}·{@code
 * iss}, 거부면 {@code error=access_denied}·{@code state}·{@code iss} 가 붙어 있다.
 */
public record AuthorizeRedirectResponse(String redirectUrl) {}
