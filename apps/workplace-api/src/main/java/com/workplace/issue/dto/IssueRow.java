package com.workplace.issue.dto;

import java.time.Instant;
import java.time.LocalDate;

/**
 * 리포지토리 → 서비스 전달용 내부 이슈 row. 외부 응답에는 {@link IssueResponse} 등 사용. typeId 는 V10 이후 NOT NULL.
 * parentIssueId 는 Phase 4a 부터 — SUBTASK 만 NOT NULL.
 */
public record IssueRow(
    Long id,
    Long projectId,
    int number,
    String title,
    String body,
    String status,
    String priority,
    LocalDate dueDate,
    Long reporterId,
    Instant createdAt,
    Instant updatedAt,
    Instant closedAt,
    Long typeId,
    Long parentIssueId,
    LocalDate startDate,
    Long milestoneId) {}
