package com.workplace.issue.dto;

import com.workplace.global.dto.UserSummary;
import com.workplace.label.dto.LabelSummary;
import java.time.Instant;
import java.time.LocalDate;
import java.util.List;

/**
 * 이슈 목록·요약 응답 DTO. projectKey 는 컨텍스트(프로젝트)에서 주입한다. labels/attachmentCount/type/assignees 는 호출자가 채우지
 * 않으면 빈 값. Phase 4a 부터 parent/childCount/childDoneCount 가 추가됨. Phase 4b 부터 blockedBy/blocks/blocked
 * 가 추가됨 — 기존 6 factory 는 default (List.of(), List.of(), false) 로 유지. Phase 4c 부터 customFields 추가 —
 * 기존 7 factory 는 default List.of() 로 유지하며 신규 fromWithCustomFields 가 풀버전.
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
    List<UserSummary> assignees,
    ParentRef parent,
    int childCount,
    int childDoneCount,
    List<IssueLinkSummary> blockedBy,
    List<IssueLinkSummary> blocks,
    boolean blocked,
    List<IssueFieldEntry> customFields) {

  /**
   * projectKey + 내부 row → 응답 변환. labels/type/assignees null, attachmentCount 0 — Phase 1·2 호출자 호환.
   * parent/childCount/childDoneCount/blockedBy/blocks/blocked 는 default.
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
        List.of(),
        null,
        0,
        0,
        List.of(),
        List.of(),
        false,
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
        List.of(),
        null,
        0,
        0,
        List.of(),
        List.of(),
        false,
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
        List.of(),
        null,
        0,
        0,
        List.of(),
        List.of(),
        false,
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
        assignees == null ? List.of() : assignees,
        null,
        0,
        0,
        List.of(),
        List.of(),
        false,
        List.of());
  }

  /** Phase 4 — 라벨 + 첨부 카운트 + 유형 + 담당자 모두 채운 풀버전. */
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
        assignees == null ? List.of() : assignees,
        null,
        0,
        0,
        List.of(),
        List.of(),
        false,
        List.of());
  }

  /**
   * Phase 4a — 부모/자식 트리 정보까지 채운 풀버전. parent 는 SUBTASK 일 때만 non-null, childCount/childDoneCount 는
   * 비SUBTASK 의 자식 집계. (의존성 default 유지)
   */
  public static IssueResponse fromWithSubtasks(
      String projectKey,
      IssueRow r,
      List<LabelSummary> labels,
      int attachmentCount,
      IssueTypeSummary type,
      List<UserSummary> assignees,
      ParentRef parent,
      int childCount,
      int childDoneCount) {
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
        assignees == null ? List.of() : assignees,
        parent,
        childCount,
        childDoneCount,
        List.of(),
        List.of(),
        false,
        List.of());
  }

  /** Phase 4b — 의존성(blockedBy/blocks/blocked) 까지 채운 최신 풀버전. 검색/상세 경로에서 사용. */
  public static IssueResponse fromWithDeps(
      String projectKey,
      IssueRow r,
      List<LabelSummary> labels,
      int attachmentCount,
      IssueTypeSummary type,
      List<UserSummary> assignees,
      ParentRef parent,
      int childCount,
      int childDoneCount,
      List<IssueLinkSummary> blockedBy,
      List<IssueLinkSummary> blocks,
      boolean blocked) {
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
        assignees == null ? List.of() : assignees,
        parent,
        childCount,
        childDoneCount,
        blockedBy == null ? List.of() : blockedBy,
        blocks == null ? List.of() : blocks,
        blocked,
        List.of());
  }

  /**
   * Phase 4c — 의존성 + customFields 까지 채운 최신 풀버전. 검색/상세 경로에서 사용. customFields 는 null 이면 빈 리스트로 정규화.
   */
  public static IssueResponse fromWithCustomFields(
      String projectKey,
      IssueRow r,
      List<LabelSummary> labels,
      int attachmentCount,
      IssueTypeSummary type,
      List<UserSummary> assignees,
      ParentRef parent,
      int childCount,
      int childDoneCount,
      List<IssueLinkSummary> blockedBy,
      List<IssueLinkSummary> blocks,
      boolean blocked,
      List<IssueFieldEntry> customFields) {
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
        assignees == null ? List.of() : assignees,
        parent,
        childCount,
        childDoneCount,
        blockedBy == null ? List.of() : blockedBy,
        blocks == null ? List.of() : blocks,
        blocked,
        customFields == null ? List.of() : customFields);
  }
}
