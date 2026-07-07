package com.workplace.global.security;

import org.springframework.boot.context.properties.ConfigurationProperties;

/** JWT 관련 설정. refreshGracePeriodSeconds: 최근 rotate된 refresh 토큰의 재사용을 탈취로 오판하지 않는 유예 기간(초). */
@ConfigurationProperties(prefix = "app.jwt")
public record JwtProperties(
    String secret, long accessExpiration, long refreshExpiration, long refreshGracePeriodSeconds) {}
