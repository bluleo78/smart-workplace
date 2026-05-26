package com.workplace.auth.dto;

import java.time.Instant;

/** 관리자/조회용 OAuth 토큰 메타 응답. **평문/암호화 토큰 절대 포함 금지** — toString 도 안전. */
public record OAuthTokenMetaResponse(
    Long id, String label, Instant createdAt, Instant lastUsedAt) {}
