package com.workplace.issue.dto;

import java.time.Instant;
import java.time.LocalDate;

/**
 * 리포지토리 → 서비스 전달용 내부 이슈 row. 외부 응답에는 {@link IssueResponse} 등 사용. typeId 는 V10 이후 NOT NULL.
 * parentIssueId 는 Phase 4a 부터 — SUBTASK 만 NOT NULL.
 *
 * <p>WP-807: status 는 상태의 범주(TODO/IN_PROGRESS/DONE/CANCELED), statusId 가 프로젝트 상태(project_status)
 * 행이다. statusName·statusPosition 은 그 상태의 이름·순서(스칼라 서브쿼리) — 행을 읽은 시점의 값이라 이력에 그대로 남긴다.
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
    Long milestoneId,
    int version,
    // 연결된 마일스톤 이름 — 없으면 null(WP-307).
    String milestoneName,
    // WP-807 프로젝트 상태 — id·이름·표시 순서.
    Long statusId,
    String statusName,
    Integer statusPosition) {}
