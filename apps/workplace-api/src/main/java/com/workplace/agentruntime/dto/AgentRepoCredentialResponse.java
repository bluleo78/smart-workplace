package com.workplace.agentruntime.dto;

import java.time.OffsetDateTime;

/**
 * AI 저장소 토큰 메타(WP-1268) — 토큰은 절대 싣지 않는다.
 *
 * @param lastUsedAt runner 가 마지막으로 받아 간 때(받은 적 없으면 null)
 */
public record AgentRepoCredentialResponse(
    long id, String kind, String host, OffsetDateTime createdAt, OffsetDateTime lastUsedAt) {}
