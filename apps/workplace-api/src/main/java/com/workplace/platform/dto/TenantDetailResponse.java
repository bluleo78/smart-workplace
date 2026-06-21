package com.workplace.platform.dto;

import java.time.LocalDateTime;

/** 운영자 콘솔 — 테넌트 상세(멤버 수 집계 포함). */
public record TenantDetailResponse(
    Long id,
    String slug,
    String name,
    String status,
    long memberCount,
    LocalDateTime createdAt,
    long quotaBytes) {}
