package com.workplace.label.dto;

import java.time.Instant;

/** 라벨 단건 응답 DTO. */
public record LabelResponse(
    Long id,
    Long projectId,
    String name,
    String colorToken,
    Instant createdAt,
    Instant updatedAt) {}
