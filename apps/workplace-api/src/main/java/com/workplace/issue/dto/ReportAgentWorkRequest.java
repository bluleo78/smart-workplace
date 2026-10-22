package com.workplace.issue.dto;

import com.workplace.global.time.SupportedDateTime;
import jakarta.validation.constraints.AssertTrue;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.Size;
import java.time.Instant;
import java.util.List;

/**
 * AI 작업 명시 보고 요청(WP-377 §4.1). 모든 필드가 선택이며 보낸 필드만 갱신한다. note 빈 문자열은 "지우기", 종료
 * 상태(COMPLETED·FAILED·CANCELED·REJECTED)는 작업 종료. message 는 이슈 챗에 호출자 이름으로 올라가는 글(최대 4000자).
 * nextRunAt 은 다음 회차 대기(SCHEDULED)일 때만 보낼 수 있는 다음 실행 시각(WP-450) — 선택값이며 과거 시각도 받는다(= 지금 할 차례).
 * fileIds 는 message 챗 글에 붙일 스테이징 파일(WP-515) — 시안·검증 스크린샷을 질문·보고와 함께 보이게 한다.
 */
public record ReportAgentWorkRequest(
    String state,
    @Size(max = 120) String note,
    @Min(0) @Max(100) Integer progress,
    @Min(0) Integer stepsDone,
    @Min(1) Integer stepsTotal,
    @Size(max = 4000) String message,
    @SupportedDateTime Instant nextRunAt,
    @Size(max = 10) List<Long> fileIds) {

  /** 상태는 보고 가능한 값(진행 중 7종 + 종료 4종)만 — 없으면 통과. 값 목록은 {@link AgentWorkState} 한 곳에서 나온다. */
  @AssertTrue(message = "보고할 수 없는 작업 상태입니다")
  public boolean isStateReportable() {
    return state == null || AgentWorkState.isReportable(state);
  }

  /** nextRunAt 은 상태가 SCHEDULED 일 때만 — 다른 상태(미지정 포함)에 시각이 붙으면 어느 상태의 시각인지 모호해 거절한다. */
  @AssertTrue(message = "nextRunAt 은 state 가 SCHEDULED 일 때만 쓸 수 있습니다")
  public boolean isNextRunAtWithScheduled() {
    return nextRunAt == null || AgentWorkState.SCHEDULED.equals(state);
  }

  /** 첨부는 message 챗 글에 붙으므로 message 가 있을 때만 — 없으면 붙일 글이 없어 파일이 조용히 버려진다. */
  @AssertTrue(message = "fileIds 는 message 와 함께만 쓸 수 있습니다")
  public boolean isFileIdsWithMessage() {
    return fileIds().isEmpty() || (message != null && !message.isBlank());
  }

  /** null 안전 접근자 — 미전달 시 빈 리스트. */
  public List<Long> fileIds() {
    return fileIds == null ? List.of() : fileIds;
  }

  /** 단계 수는 짝으로만 — 둘 다 없거나 둘 다 있고 done ≤ total. */
  @AssertTrue(message = "stepsDone 과 stepsTotal 은 함께 주어야 하고 stepsDone 은 stepsTotal 이하여야 합니다")
  public boolean isStepsPaired() {
    if (stepsDone == null && stepsTotal == null) return true;
    return stepsDone != null && stepsTotal != null && stepsDone <= stepsTotal;
  }
}
