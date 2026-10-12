package com.workplace.platform.dto;

import java.time.LocalDateTime;

/**
 * 운영자 콘솔 — 테넌트 상세(멤버 수 집계 포함).
 *
 * <p>{@code deletedAt} 은 삭제(DELETED) 시각, {@code purgeError} 는 마지막 영구 삭제 실패 사유(없으면 null) — WP-341.
 *
 * <p>{@code deletable} 은 삭제·영구 삭제 가능 여부 — 기본 테넌트만 false(콘솔이 id 상수를 따로 들고 있지 않도록 서버가 알려준다).
 */
public record TenantDetailResponse(
    Long id,
    String slug,
    String name,
    String status,
    long memberCount,
    LocalDateTime createdAt,
    long quotaBytes,
    LocalDateTime deletedAt,
    String purgeError,
    boolean deletable) {}
