package com.workplace.agentruntime.dto;

/** 검증된 runner 토큰이 가리키는 주체(WP-1248) — 토큰을 발급한 테넌트와 위치. runner 의 이후 요청은 이 테넌트·위치에만 닿아야 한다. */
public record RunnerPrincipal(long tenantId, long locationId) {}
