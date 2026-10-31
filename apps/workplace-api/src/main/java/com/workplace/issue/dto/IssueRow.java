package com.workplace.issue.dto;

import java.time.Instant;
import java.time.LocalDate;

/**
 * 리포지토리 → 서비스 전달용 내부 이슈 row. 외부 응답에는 {@link IssueResponse} 등 사용. typeId 는 V10 이후 NOT NULL.
 * parentIssueId 는 Phase 4a 부터 — SUBTASK 만 NOT NULL.
 *
 * <p>WP-807: status 는 상태의 범주(TODO/IN_PROGRESS/DONE/CANCELED), statusId 가 프로젝트 상태(project_status)
 * 행이다. statusName·statusColor 는 그 상태의 이름·색(project_status LEFT JOIN, WP-870) — 행을 읽은 시점의 값이라 이력에
 * 그대로 남긴다.
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
    // WP-807 프로젝트 상태 — id·이름.
    Long statusId,
    String statusName,
    // WP-870 상태 색 토큰(GRAY·BLUE …) — 웹 배지가 상태 목록을 따로 읽지 않고 색을 칠한다.
    String statusColor,
    // WP-1017 에픽 색 토큰 — 에픽만 쓴다(그 밖의 유형·색을 정하기 전 에픽은 null). 에픽에서 다른 유형으로 바꿔도 값은 남겨, 다시 에픽이
    // 되면 원래 색으로 돌아온다.
    String epicColor,
    // WP-1239 가져온 이슈의 원본 키(issue.import_source_key) — 없으면 null.
    String sourceKey) {

  /** 원본 키가 없던 22-인자 호환 생성자 — 원본 키를 모르는 기존 호출부(테스트 픽스처 등)용(sourceKey null). */
  public IssueRow(
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
      String milestoneName,
      Long statusId,
      String statusName,
      String statusColor,
      String epicColor) {
    this(
        id,
        projectId,
        number,
        title,
        body,
        status,
        priority,
        dueDate,
        reporterId,
        createdAt,
        updatedAt,
        closedAt,
        typeId,
        parentIssueId,
        startDate,
        milestoneId,
        version,
        milestoneName,
        statusId,
        statusName,
        statusColor,
        epicColor,
        null);
  }

  /** 에픽 색이 없던 21-인자 호환 생성자 — 에픽 색을 모르는 기존 호출부(테스트 픽스처 등)용(epicColor null). */
  public IssueRow(
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
      String milestoneName,
      Long statusId,
      String statusName,
      String statusColor) {
    this(
        id,
        projectId,
        number,
        title,
        body,
        status,
        priority,
        dueDate,
        reporterId,
        createdAt,
        updatedAt,
        closedAt,
        typeId,
        parentIssueId,
        startDate,
        milestoneId,
        version,
        milestoneName,
        statusId,
        statusName,
        statusColor,
        null);
  }

  /** 에픽 색만 바꾼 사본 — 생성·유형 변경 때 정한 색을 다시 읽지 않고 응답에 싣는다. */
  public IssueRow withEpicColor(String newEpicColor) {
    return new IssueRow(
        id,
        projectId,
        number,
        title,
        body,
        status,
        priority,
        dueDate,
        reporterId,
        createdAt,
        updatedAt,
        closedAt,
        typeId,
        parentIssueId,
        startDate,
        milestoneId,
        version,
        milestoneName,
        statusId,
        statusName,
        statusColor,
        newEpicColor,
        sourceKey);
  }
}
