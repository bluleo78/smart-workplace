package com.workplace.auth.dto;

import java.time.Instant;

/**
 * AGENT API 키 메타 (평문/해시 제외). 목록/조회 응답.
 *
 * @param managed Works 가 작업 공간 AI 에 자동 발급한 키인지(WP-1253) — 관리자 목록에 「Works 자동 발급」으로 보인다
 * @param expiresAt 만료 시각(관리자 발급 키는 null = 만료 없음)
 */
public record AgentApiKeyResponse(
    Long id,
    Long userId,
    String keyPrefix,
    String label,
    Long createdBy,
    Instant createdAt,
    Instant lastUsedAt,
    Instant revokedAt,
    boolean managed,
    Instant expiresAt) {}
