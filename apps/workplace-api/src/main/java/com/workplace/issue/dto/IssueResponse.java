package com.workplace.issue.dto;

import java.time.Instant;
import java.time.LocalDate;

/** 이슈 목록·요약 응답 DTO. projectKey 는 컨텍스트(프로젝트)에서 주입한다. */
public record IssueResponse(
    Long id,
    String projectKey,
    int number,
    String title,
    String status,
    String priority,
    LocalDate dueDate,
    Long reporterId,
    Long assigneeId,
    Instant createdAt,
    Instant updatedAt) {

  /** projectKey + 내부 row → 응답 변환. */
  public static IssueResponse from(String projectKey, IssueRow r) {
    return new IssueResponse(
        r.id(),
        projectKey,
        r.number(),
        r.title(),
        r.status(),
        r.priority(),
        r.dueDate(),
        r.reporterId(),
        r.assigneeId(),
        r.createdAt(),
        r.updatedAt());
  }
}
