package com.workplace.issue.dto;

import jakarta.validation.constraints.AssertTrue;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

/**
 * AI 작업 명시 보고 요청(WP-377 §4.1). 모든 필드가 선택이며 보낸 필드만 갱신한다. note 빈 문자열은 "지우기", ENDED 는 작업 종료. message 는
 * 이슈 챗에 호출자 이름으로 올라가는 글(최대 4000자).
 */
public record ReportAgentWorkRequest(
    @Pattern(regexp = "WORKING|WAITING|REVIEW|BLOCKED|PAUSED|ENDED") String state,
    @Size(max = 120) String note,
    @Min(0) @Max(100) Integer progress,
    @Min(0) Integer stepsDone,
    @Min(1) Integer stepsTotal,
    @Size(max = 4000) String message) {

  /** 단계 수는 짝으로만 — 둘 다 없거나 둘 다 있고 done ≤ total. */
  @AssertTrue(
      message = "stepsDone and stepsTotal must be given together with stepsDone <= stepsTotal")
  public boolean isStepsPaired() {
    if (stepsDone == null && stepsTotal == null) return true;
    return stepsDone != null && stepsTotal != null && stepsDone <= stepsTotal;
  }
}
