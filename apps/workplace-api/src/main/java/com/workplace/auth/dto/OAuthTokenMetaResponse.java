package com.workplace.auth.dto;

import java.time.Instant;

/**
 * 관리자/조회용 자격증명 메타 응답. **평문/암호화 토큰·apiKey 절대 포함 금지** — toString 도 안전. baseUrl 은 opencode 일 때만
 * payload 의 options.baseURL(추출 실패 시 null), anthropic 이면 null.
 */
public record OAuthTokenMetaResponse(
    Long id,
    String provider,
    String baseUrl,
    String label,
    Instant createdAt,
    Instant lastUsedAt) {}
