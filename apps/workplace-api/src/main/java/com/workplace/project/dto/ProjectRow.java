package com.workplace.project.dto;

import java.time.Instant;

/** 리포지토리 → 서비스 전달용 내부 row. 외부 응답에는 {@link ProjectResponse} 사용. */
public record ProjectRow(
    Long id,
    String key,
    String name,
    String description,
    Long ownerId,
    String type,
    boolean isDefault,
    Instant createdAt,
    Instant updatedAt) {}
