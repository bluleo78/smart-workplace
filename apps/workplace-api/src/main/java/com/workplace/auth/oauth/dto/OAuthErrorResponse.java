package com.workplace.auth.oauth.dto;

import com.fasterxml.jackson.annotation.JsonProperty;

/**
 * OAuth 표준 오류 본문(RFC 6749 §5.2·RFC 7591 §3.2.2, WP-1685) — {@code {"error","error_description"}}
 * snake_case. 등록·토큰 엔드포인트가 쓴다.
 */
public record OAuthErrorResponse(
    @JsonProperty("error") String error,
    @JsonProperty("error_description") String errorDescription) {}
