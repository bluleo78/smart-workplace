package com.workplace.auth.dto;

import java.time.Instant;

/** 키 발급 응답. plaintextKey 는 발급 직후 1회만 노출되며 이후엔 다시 표시할 수 없다. */
public record AgentApiKeyIssueResponse(
    Long id, Long userId, String plaintextKey, String keyPrefix, String label, Instant createdAt) {}
