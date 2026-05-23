package com.workplace.label.dto;

import java.time.Instant;

/** 리포지토리 → 서비스 전달용 내부 라벨 row. */
public record LabelRow(
    Long id,
    Long projectId,
    String name,
    String colorToken,
    Instant createdAt,
    Instant updatedAt) {}
