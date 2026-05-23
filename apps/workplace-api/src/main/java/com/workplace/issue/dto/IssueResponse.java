package com.workplace.issue.dto;

import com.workplace.label.dto.LabelSummary;
import java.time.Instant;
import java.time.LocalDate;
import java.util.List;

/**
 * 이슈 목록·요약 응답 DTO. projectKey 는 컨텍스트(프로젝트)에서 주입한다. labels/attachmentCount 는 호출자가 채우지 않으면 빈 리스트 / 0.
 */
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
    List<LabelSummary> labels,
    int attachmentCount) {

  /** projectKey + 내부 row → 응답 변환. labels 빈 리스트, attachmentCount 0 으로 기본 — Phase 1·2 호출자 호환. */
  public static IssueResponse from(String projectKey, IssueRow r) {
    return fromWithDetails(projectKey, r, List.of(), 0);
  }

  /** projectKey + 내부 row + 라벨 → 응답 변환. attachmentCount 0 default — Phase 3a 호출자 호환. */
  public static IssueResponse fromWithLabels(
      String projectKey, IssueRow r, List<LabelSummary> labels) {
    return fromWithDetails(projectKey, r, labels, 0);
  }

  /** 라벨 + 첨부 카운트까지 채운 풀버전 — Phase 3b 검색/상세에서 사용. */
  public static IssueResponse fromWithDetails(
      String projectKey, IssueRow r, List<LabelSummary> labels, int attachmentCount) {
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
        labels == null ? List.of() : labels,
        attachmentCount);
  }
}
