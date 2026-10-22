package com.workplace.issue.dto;

import java.time.Instant;

/** project_status 한 행(WP-807). category 는 {@link IssueStatuses} 범주 값, position 은 프로젝트 안 표시 순서. */
public record ProjectStatusRow(
    Long id,
    Long projectId,
    String name,
    String category,
    int position,
    Instant createdAt,
    Instant updatedAt) {}
