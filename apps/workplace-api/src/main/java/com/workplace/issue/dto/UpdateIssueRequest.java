package com.workplace.issue.dto;

import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import java.time.LocalDate;

/**
 * 이슈 부분 수정 요청. null 필드는 변경 없음을 의미. clearDueDate 플래그로 명시적 NULL 설정을 지원한다. version 을 주면 그 사이 다른 편집이
 * 있었을 때 409(#611). 담당자는 별도 PUT 엔드포인트로 관리하므로 본 record 에서 제거되었다.
 */
public record UpdateIssueRequest(
    @Size(max = 200) String title,
    @Size(max = 10000) String body,
    @Pattern(regexp = IssueStatuses.CATEGORY_REGEX) String status,
    @Pattern(regexp = "LOW|MID|HIGH") String priority,
    LocalDate dueDate,
    Boolean clearDueDate,
    LocalDate startDate,
    Boolean clearStartDate,
    Long milestoneId,
    Boolean clearMilestone,
    // #611 낙관적 동시성 — 클라이언트가 마지막으로 읽은 이슈 version. null 이면 검사하지 않는다(보드 드래그·일괄 변경·AI 도구 등).
    Integer version,
    // WP-807 프로젝트 상태 id — status(범주)보다 우선한다. 범주만 오면 이미 그 범주인 이슈는 상태를 유지하고 아니면 범주 기본 상태로 간다.
    Long statusId,
    // WP-870 프로젝트 상태 이름 — 서버가 상태 id(범주 코드면 범주)로 해석한다. 우선순위는 statusId → statusName → status.
    String statusName) {

  /** 상태만 바꾸는 요청(WP-807) — PATCH /status·시스템 전이가 쓴다. 범주·상태 id 중 statusId 가 우선한다. */
  public static UpdateIssueRequest statusOnly(String category, Long statusId) {
    return statusOnly(category, statusId, null);
  }

  /** 상태만 바꾸는 요청에 상태 이름(WP-870)까지 — PATCH /status 가 쓴다. statusId → statusName → 범주 순으로 이긴다. */
  public static UpdateIssueRequest statusOnly(String category, Long statusId, String statusName) {
    return new UpdateIssueRequest(
        null,
        null,
        category,
        null,
        null,
        false,
        null,
        false,
        null,
        false,
        null,
        statusId,
        statusName);
  }

  /** 상태 지정만 바꾼 사본 — 서버가 statusName 을 상태 id·범주로 해석한 뒤 이후 로직에 넘길 때 쓴다(WP-870). 이름은 비운다. */
  public UpdateIssueRequest withResolvedStatus(String category, Long resolvedStatusId) {
    return new UpdateIssueRequest(
        title,
        body,
        category,
        priority,
        dueDate,
        clearDueDate,
        startDate,
        clearStartDate,
        milestoneId,
        clearMilestone,
        version,
        resolvedStatusId,
        null);
  }

  /** WP-870 이전의 12-인자 호환 생성자 — 상태 이름 없이 수정한다. */
  public UpdateIssueRequest(
      String title,
      String body,
      String status,
      String priority,
      LocalDate dueDate,
      Boolean clearDueDate,
      LocalDate startDate,
      Boolean clearStartDate,
      Long milestoneId,
      Boolean clearMilestone,
      Integer version,
      Long statusId) {
    this(
        title,
        body,
        status,
        priority,
        dueDate,
        clearDueDate,
        startDate,
        clearStartDate,
        milestoneId,
        clearMilestone,
        version,
        statusId,
        null);
  }

  /** WP-807 이전의 11-인자 호환 생성자 — 상태 id 없이(범주만) 수정한다. */
  public UpdateIssueRequest(
      String title,
      String body,
      String status,
      String priority,
      LocalDate dueDate,
      Boolean clearDueDate,
      LocalDate startDate,
      Boolean clearStartDate,
      Long milestoneId,
      Boolean clearMilestone,
      Integer version) {
    this(
        title,
        body,
        status,
        priority,
        dueDate,
        clearDueDate,
        startDate,
        clearStartDate,
        milestoneId,
        clearMilestone,
        version,
        null,
        null);
  }
}
