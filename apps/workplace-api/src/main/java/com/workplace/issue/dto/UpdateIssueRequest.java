package com.workplace.issue.dto;

import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import java.time.LocalDate;
import java.util.List;

/**
 * 이슈 부분 수정 요청. null 필드는 변경 없음을 의미. clearDueDate 플래그로 명시적 NULL 설정을 지원한다. version 을 주면 그 사이 다른 편집이
 * 있었을 때 409(#611). 담당자는 별도 PUT 엔드포인트로 관리하므로 본 record 에서 제거되었다.
 */
public record UpdateIssueRequest(
    @Size(max = 200) String title,
    @Size(max = IssueTextLimits.BODY_MAX) String body,
    @Pattern(regexp = IssueStatuses.CATEGORY_REGEX) String status,
    @Pattern(regexp = IssuePriorities.REGEX) String priority,
    LocalDate dueDate,
    Boolean clearDueDate,
    LocalDate startDate,
    Boolean clearStartDate,
    Long milestoneId,
    Boolean clearMilestone,
    // #611 낙관적 동시성 — 클라이언트가 마지막으로 읽은 이슈 version. null 이면 검사하지 않는다(보드 드래그·일괄 변경·AI 도구 등).
    // 단, 제목·본문(WP-2113)이 실제로 바뀌면 null 이어도 409 — 에코(같은 값)·단일 값 필드·첨부 전용 요청은 그대로 통과한다.
    Integer version,
    // WP-807 프로젝트 상태 id — status(범주)보다 우선한다. 범주만 오면 이미 그 범주인 이슈는 상태를 유지하고 아니면 범주 기본 상태로 간다.
    Long statusId,
    // WP-870 프로젝트 상태 이름 — 서버가 상태 id(범주 코드면 범주)로 해석한다. 우선순위는 statusId → statusName → status.
    String statusName,
    // WP-1780 먼저 올려 둔 스테이징 파일(WP-421)을 이슈 첨부로 묶는다 — 만들기(CreateIssueRequest.fileIds)와 같은 규칙. 본문
    // 자리표시에 쓴 번호는 서버가 빼므로 클라이언트가 가려내지 않아도 된다.
    @Size(max = 20) List<Long> fileIds) {

  /** WP-1780 이전의 13-인자 호환 생성자 — 첨부(fileIds) 없이 만든다. 기존 호출부가 그대로 쓴다. */
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
      Long statusId,
      String statusName) {
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
        statusName,
        null);
  }

  /** 상태만 바꾸는 요청(WP-807·WP-870) — PATCH /status·시스템 전이가 쓴다. statusId → statusName → 범주 순으로 이긴다. */
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
        statusName,
        null);
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
        null,
        fileIds);
  }

  /**
   * fileIds 말고 바뀌는 필드가 하나도 없는 첨부 전용 요청인지(WP-1780). 필드 목록 바로 옆에 두어, 필드를 더할 때 여기도 함께 고치게 한다 — 빠뜨리면 그
   * 필드를 담은 요청이 첨부 전용으로 갈려 값이 조용히 버려진다. 상태 이름은 서비스가 이 판정 전에 statusId 로 해석한다. version 은 충돌 검사용일 뿐 바뀌는
   * 필드가 아니다.
   */
  public boolean isAttachOnly() {
    return fileIds != null
        && !fileIds.isEmpty()
        && title == null
        && body == null
        && status == null
        && statusId == null
        && statusName == null
        && priority == null
        && dueDate == null
        && !Boolean.TRUE.equals(clearDueDate)
        && startDate == null
        && !Boolean.TRUE.equals(clearStartDate)
        && milestoneId == null
        && !Boolean.TRUE.equals(clearMilestone);
  }
}
