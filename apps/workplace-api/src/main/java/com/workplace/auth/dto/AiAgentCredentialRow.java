package com.workplace.auth.dto;

import java.time.Instant;

/**
 * Phase 5c-2 후속 (#33): ai_agent_credential 행 DTO. encryptedToken 은 복호화 전 값이므로 응답 DTO 로 직접 노출 금지 —
 * service 가 OAuthTokenMetaResponse 로 좁혀 반환한다.
 */
public record AiAgentCredentialRow(
    Long id,
    Long userId,
    String provider,
    String encryptedToken,
    String label,
    Long createdBy,
    Instant createdAt,
    Instant lastUsedAt,
    Instant revokedAt) {}
