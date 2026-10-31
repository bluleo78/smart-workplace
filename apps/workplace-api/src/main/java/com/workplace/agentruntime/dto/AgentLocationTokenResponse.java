package com.workplace.agentruntime.dto;

/** 위치 생성·토큰 재발급 응답(WP-1248) — {@code plaintextToken} 평문은 이 응답에서만 한 번 보인다. */
public record AgentLocationTokenResponse(AgentLocationResponse location, String plaintextToken) {}
