package com.workplace.auth.dto;

import java.time.Instant;

/** PAT 목록/단건 응답. 평문·해시는 절대 포함하지 않는다. */
public record UserApiTokenResponse(
    Long id,
    String name,
    String tokenPrefix,
    Long tenantId,
    Instant expiresAt,
    Instant createdAt,
    Instant lastUsedAt,
    Instant revokedAt) {}
