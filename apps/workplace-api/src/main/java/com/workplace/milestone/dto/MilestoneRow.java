package com.workplace.milestone.dto;

import java.time.Instant;
import java.time.LocalDate;

/** 리포지토리 → 서비스 전달용 내부 마일스톤 row. */
public record MilestoneRow(
    Long id,
    Long projectId,
    String name,
    LocalDate dueDate,
    String description,
    Instant createdAt,
    Instant updatedAt) {}
