package com.workplace.platform.dto;

import java.time.LocalDateTime;

/**
 * 운영자 콘솔 — 테넌트 목록 항목(멤버 수 집계 포함).
 *
 * <p>{@code deletedAt} 은 삭제(DELETED) 시각, {@code purgeError} 는 마지막 영구 삭제 실패 사유(없으면 null) — WP-341.
 */
public record TenantSummaryResponse(
    Long id,
    String slug,
    String name,
    String status,
    long memberCount,
    LocalDateTime createdAt,
    LocalDateTime deletedAt,
    String purgeError) {}
