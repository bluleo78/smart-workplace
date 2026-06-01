package com.workplace.view.dto;

import java.time.Instant;

/** 리포지토리 → 서비스 전달용 내부 saved_view row. */
public record SavedViewRow(
    Long id,
    Long projectId,
    Long ownerId,
    String name,
    String query,
    String visibility,
    Instant createdAt,
    Instant updatedAt) {}
