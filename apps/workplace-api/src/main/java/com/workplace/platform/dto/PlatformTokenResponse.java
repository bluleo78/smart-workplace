package com.workplace.platform.dto;

/** 운영자 토큰 응답 — access token 은 바디로, refresh 는 쿠키로 분리 전달한다. */
public record PlatformTokenResponse(String accessToken, String tokenType, long expiresIn) {}
