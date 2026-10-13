package com.workplace.issue.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import java.time.LocalDate;
import java.util.List;

/**
 * 이슈 생성 요청. priority 기본값(MID)은 서비스에서 적용. assigneeIds 는 다중 담당자(선택). typeId 미지정 시 프로젝트의 TASK 시스템 유형으로
 * fallback. parentNumber 는 SUBTASK 생성 시 필수, 비SUBTASK 면 null 이어야 한다 (Phase 4a).
 *
 * <p>WP-356: labelIds·milestoneId·cycleIds 는 생성과 같은 트랜잭션에서 붙인다 — 생성 후 PUT 을 따로 부르면 중간 실패 시 라벨 없는
 * 이슈만 남는다(비원자적). 모두 같은 프로젝트 소속이어야 하고, 프로젝트 멤버(또는 ADMIN)만 지정할 수 있다(수정 경로와 같은 규칙).
 */
public record CreateIssueRequest(
    @NotBlank @Size(max = 200) String title,
    @Size(max = 10000) String body,
    @Pattern(regexp = "LOW|MID|HIGH") String priority,
    LocalDate dueDate,
    List<Long> assigneeIds,
    Long typeId,
    Integer parentNumber,
    LocalDate startDate,
    List<Long> labelIds,
    Long milestoneId,
    List<Long> cycleIds) {

  /** 라벨·마일스톤·사이클 없이 만드는 기존 8-인자 호환 생성자 — 기존 호출부(메일 승격 외 시드·테스트)가 그대로 쓴다. */
  public CreateIssueRequest(
      String title,
      String body,
      String priority,
      LocalDate dueDate,
      List<Long> assigneeIds,
      Long typeId,
      Integer parentNumber,
      LocalDate startDate) {
    this(
        title,
        body,
        priority,
        dueDate,
        assigneeIds,
        typeId,
        parentNumber,
        startDate,
        null,
        null,
        null);
  }
}
