package com.workplace.issue.dto;

import com.workplace.label.dto.LabelSummary;
import java.time.Instant;
import java.time.LocalDate;
import java.util.List;

/**
 * 이슈 목록·요약 응답 DTO. projectKey 는 컨텍스트(프로젝트)에서 주입한다. labels/attachmentCount/type/assignees 는 호출자가 채우지
 * 않으면 빈 값.
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
    Instant createdAt,
    Instant updatedAt,
    List<LabelSummary> labels,
    int attachmentCount,
    IssueTypeSummary type,
    List<UserSummary> assignees) {

  /**
   * projectKey + 내부 row → 응답 변환. labels/type/assignees null, attachmentCount 0 — Phase 1·2 호출자 호환.
   */
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
        r.createdAt(),
        r.updatedAt(),
        List.of(),
        0,
        null,
        List.of());
  }

  /**
   * projectKey + 내부 row + 라벨 → 응답 변환. attachmentCount 0, type null, assignees 빈 리스트 — Phase 3a 호출자
   * 호환.
   */
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
        r.createdAt(),
        r.updatedAt(),
        labels == null ? List.of() : labels,
        0,
        null,
        List.of());
  }

  /** 라벨 + 첨부 카운트까지 채운 버전 — Phase 3b 호출자 호환. type null, assignees 빈 리스트. */
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
        r.createdAt(),
        r.updatedAt(),
        labels == null ? List.of() : labels,
        attachmentCount,
        null,
        List.of());
  }

  /** 라벨 + 첨부 카운트 + 담당자까지 채운 풀버전 — Phase 3c 호출자 호환. type null. */
  public static IssueResponse fromWithFullDetails(
      String projectKey,
      IssueRow r,
      List<LabelSummary> labels,
      int attachmentCount,
      List<UserSummary> assignees) {
    return new IssueResponse(
        r.id(),
        projectKey,
        r.number(),
        r.title(),
        r.status(),
        r.priority(),
        r.dueDate(),
        r.reporterId(),
        r.createdAt(),
        r.updatedAt(),
        labels == null ? List.of() : labels,
        attachmentCount,
        null,
        assignees == null ? List.of() : assignees);
  }

  /** Phase 4 — 라벨 + 첨부 카운트 + 유형 + 담당자 모두 채운 최신 풀버전. 검색/상세에서 사용. */
  public static IssueResponse fromWithType(
      String projectKey,
      IssueRow r,
      List<LabelSummary> labels,
      int attachmentCount,
      IssueTypeSummary type,
      List<UserSummary> assignees) {
    return new IssueResponse(
        r.id(),
        projectKey,
        r.number(),
        r.title(),
        r.status(),
        r.priority(),
        r.dueDate(),
        r.reporterId(),
        r.createdAt(),
        r.updatedAt(),
        labels == null ? List.of() : labels,
        attachmentCount,
        type,
        assignees == null ? List.of() : assignees);
  }
}
