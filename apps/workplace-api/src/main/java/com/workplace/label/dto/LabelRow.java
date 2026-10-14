package com.workplace.label.dto;

import java.time.Instant;

/** 리포지토리 → 서비스 전달용 내부 라벨 row. createdBy 는 만든 사람(WP-394 이전 라벨·탈퇴자는 null). */
public record LabelRow(
    Long id,
    Long projectId,
    String name,
    String colorToken,
    Long createdBy,
    Instant createdAt,
    Instant updatedAt) {}
