package com.workplace.drive.dto;

import java.time.OffsetDateTime;

/** 링크 목록 항목. 토큰/해시는 노출하지 않는다. */
public record ShareLinkResponse(
    long id,
    String audience,
    boolean hasPassword,
    OffsetDateTime expiresAt,
    boolean revoked,
    OffsetDateTime createdAt,
    long createdBy) {}
