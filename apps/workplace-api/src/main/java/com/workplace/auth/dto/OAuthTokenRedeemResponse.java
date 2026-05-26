package com.workplace.auth.dto;

/**
 * AGENT 본인의 GET /users/me/oauth-token 응답 — 평문 토큰 포함. 본 응답은 ai-agent 측에서만 소비되며 절대 사용자 UI 로 노출되지 않는다.
 */
public record OAuthTokenRedeemResponse(String token, String label) {}
