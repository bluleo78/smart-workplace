package com.workplace.cycle.dto;

import java.time.Instant;
import java.time.LocalDate;

/** 사이클 단건 응답 DTO. */
public record CycleResponse(
    Long id,
    Long projectId,
    String name,
    String goal,
    LocalDate startDate,
    LocalDate endDate,
    String status,
    Instant createdAt,
    Instant updatedAt) {}
