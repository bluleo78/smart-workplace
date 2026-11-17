package com.workplace.auth.oauth.dto;

import com.fasterxml.jackson.annotation.JsonProperty;

/**
 * 토큰 엔드포인트 성공 본문(RFC 6749 §5.1, WP-1685) — snake_case. access 는 {@code swo_…}(1시간), refresh 는
 * {@code swr_…}(30일, 쓸 때마다 회전). token_type 은 늘 {@code Bearer}.
 */
public record TokenResponse(
    @JsonProperty("access_token") String accessToken,
    @JsonProperty("token_type") String tokenType,
    @JsonProperty("expires_in") long expiresIn,
    @JsonProperty("refresh_token") String refreshToken) {}
