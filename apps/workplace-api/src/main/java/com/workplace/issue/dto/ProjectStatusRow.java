package com.workplace.issue.dto;

import java.time.Instant;

/**
 * project_status 한 행(WP-807). category 는 {@link IssueStatuses} 범주 값, position 은 프로젝트 안 표시 순서, color
 * 는 라벨과 같은 색 토큰(WP-809).
 */
public record ProjectStatusRow(
    Long id,
    Long projectId,
    String name,
    String category,
    int position,
    String color,
    Instant createdAt,
    Instant updatedAt) {}
