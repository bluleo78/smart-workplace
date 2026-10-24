package com.workplace.issue.dto;

import com.fasterxml.jackson.annotation.JsonIgnore;
import jakarta.validation.constraints.AssertTrue;
import jakarta.validation.constraints.Pattern;

/**
 * PATCH /status 요청 — DnD 전용. status(범주)는 UpdateIssueRequest 와 동일한 값만 허용(400 으로 조기 차단).
 * statusId(프로젝트 상태, WP-807)를 주면 그것이 우선하고, 다음은 statusName(상태 이름, WP-870 — 서버가 해석), 범주만 오면 이미 그 범주인
 * 이슈는 상태를 유지하고 아니면 범주 기본 상태로 간다. 셋 다 없으면 400.
 */
public record UpdateStatusRequest(
    @Pattern(regexp = IssueStatuses.CATEGORY_REGEX) String status,
    Long statusId,
    String statusName) {

  /** 범주·상태 id·상태 이름 중 하나는 있어야 한다. 직렬화 대상이 아니다(JSON 에 "specified" 로 새지 않게). */
  @JsonIgnore
  @AssertTrue(message = "상태를 지정해 주세요")
  public boolean isSpecified() {
    return status != null || statusId != null || statusName != null;
  }
}
