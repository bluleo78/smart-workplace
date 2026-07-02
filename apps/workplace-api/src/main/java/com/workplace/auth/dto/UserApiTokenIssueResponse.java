package com.workplace.auth.dto;

import java.time.Instant;

/** PAT 발급 응답 — plaintextToken 은 이 응답에서만 1회 노출된다. */
public record UserApiTokenIssueResponse(
    Long id,
    String name,
    String plaintextToken,
    String tokenPrefix,
    Long tenantId,
    Instant expiresAt,
    Instant createdAt) {}
