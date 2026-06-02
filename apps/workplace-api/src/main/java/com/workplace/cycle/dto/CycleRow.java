package com.workplace.cycle.dto;

import java.time.Instant;
import java.time.LocalDate;

/** 리포지토리 → 서비스 전달용 내부 사이클 row. */
public record CycleRow(
    Long id,
    Long projectId,
    String name,
    String goal,
    LocalDate startDate,
    LocalDate endDate,
    String status,
    Instant createdAt,
    Instant updatedAt) {}
