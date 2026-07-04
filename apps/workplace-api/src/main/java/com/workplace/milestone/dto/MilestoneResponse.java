package com.workplace.milestone.dto;

import java.time.Instant;
import java.time.LocalDate;

/** 마일스톤 단건 응답 DTO. */
public record MilestoneResponse(
    Long id,
    Long projectId,
    String name,
    LocalDate dueDate,
    String description,
    Instant createdAt,
    Instant updatedAt) {}
