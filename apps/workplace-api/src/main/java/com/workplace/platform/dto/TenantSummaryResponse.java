package com.workplace.platform.dto;

import java.time.LocalDateTime;

/** 운영자 콘솔 — 테넌트 목록 항목(멤버 수 집계 포함). */
public record TenantSummaryResponse(
    Long id, String slug, String name, String status, long memberCount, LocalDateTime createdAt) {}
