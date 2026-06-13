package com.workplace.project.dto;

import java.time.Instant;

/** 프로젝트 API 응답 DTO. */
public record ProjectResponse(
    Long id,
    String key,
    String name,
    String description,
    Long ownerId,
    String type,
    boolean isDefault,
    Instant createdAt,
    Instant updatedAt) {

  /** 내부 row → 응답 변환. */
  public static ProjectResponse from(ProjectRow row) {
    return new ProjectResponse(
        row.id(),
        row.key(),
        row.name(),
        row.description(),
        row.ownerId(),
        row.type(),
        row.isDefault(),
        row.createdAt(),
        row.updatedAt());
  }
}
