package com.workplace.auth.dto;

import java.time.Instant;

/** AGENT API 키 메타 (평문/해시 제외). 목록/조회 응답. */
public record AgentApiKeyResponse(
    Long id,
    Long userId,
    String keyPrefix,
    String label,
    Long createdBy,
    Instant createdAt,
    Instant lastUsedAt,
    Instant revokedAt) {}
