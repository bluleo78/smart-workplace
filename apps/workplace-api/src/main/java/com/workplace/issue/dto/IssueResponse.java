package com.workplace.issue.dto;

import com.workplace.label.dto.LabelSummary;
import java.time.Instant;
import java.time.LocalDate;
import java.util.List;

/** 이슈 목록·요약 응답 DTO. projectKey 는 컨텍스트(프로젝트)에서 주입한다. labels 는 호출자가 채우지 않으면 빈 리스트. */
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
    Instant updatedAt,
    List<LabelSummary> labels) {

  /** projectKey + 내부 row → 응답 변환. labels 는 빈 리스트로 기본 — Phase 1·2 호출자 호환. */
  public static IssueResponse from(String projectKey, IssueRow r) {
    return fromWithLabels(projectKey, r, List.of());
  }

  /** projectKey + 내부 row + 라벨 → 응답 변환. */
  public static IssueResponse fromWithLabels(
      String projectKey, IssueRow r, List<LabelSummary> labels) {
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
        r.updatedAt(),
        labels == null ? List.of() : labels);
  }
}
