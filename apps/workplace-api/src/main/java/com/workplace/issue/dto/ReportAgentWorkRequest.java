package com.workplace.issue.dto;

import jakarta.validation.constraints.AssertTrue;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.Size;
import java.time.Instant;

/**
 * AI 작업 명시 보고 요청(WP-377 §4.1). 모든 필드가 선택이며 보낸 필드만 갱신한다. note 빈 문자열은 "지우기", 종료
 * 상태(COMPLETED·FAILED·CANCELED·REJECTED)는 작업 종료. message 는 이슈 챗에 호출자 이름으로 올라가는 글(최대 4000자).
 * nextRunAt 은 다음 회차 대기(SCHEDULED)일 때만 보낼 수 있는 다음 실행 시각(WP-450) — 선택값이며 과거 시각도 받는다(= 지금 할 차례).
 */
public record ReportAgentWorkRequest(
    String state,
    @Size(max = 120) String note,
    @Min(0) @Max(100) Integer progress,
    @Min(0) Integer stepsDone,
    @Min(1) Integer stepsTotal,
    @Size(max = 4000) String message,
    Instant nextRunAt) {

  /** 상태는 보고 가능한 값(진행 중 7종 + 종료 4종)만 — 없으면 통과. 값 목록은 {@link AgentWorkState} 한 곳에서 나온다. */
  @AssertTrue(message = "state must be a reportable agent work state")
  public boolean isStateReportable() {
    return state == null || AgentWorkState.isReportable(state);
  }

  /** nextRunAt 은 상태가 SCHEDULED 일 때만 — 다른 상태(미지정 포함)에 시각이 붙으면 어느 상태의 시각인지 모호해 거절한다. */
  @AssertTrue(message = "nextRunAt is only allowed with state SCHEDULED")
  public boolean isNextRunAtWithScheduled() {
    return nextRunAt == null || AgentWorkState.SCHEDULED.equals(state);
  }

  /** 단계 수는 짝으로만 — 둘 다 없거나 둘 다 있고 done ≤ total. */
  @AssertTrue(
      message = "stepsDone and stepsTotal must be given together with stepsDone <= stepsTotal")
  public boolean isStepsPaired() {
    if (stepsDone == null && stepsTotal == null) return true;
    return stepsDone != null && stepsTotal != null && stepsDone <= stepsTotal;
  }
}
