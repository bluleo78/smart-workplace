package com.workplace.drive.dto;

import java.time.OffsetDateTime;

/** 생성 직후 1회용 응답 — 평문 토큰 포함(이후 복원 불가). */
public record CreatedShareLinkResponse(
    long id, String token, String audience, boolean hasPassword, OffsetDateTime expiresAt) {}
