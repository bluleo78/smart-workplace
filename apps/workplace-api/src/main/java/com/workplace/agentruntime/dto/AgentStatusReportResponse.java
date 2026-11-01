package com.workplace.agentruntime.dto;

/**
 * AI 상태 보고 응답(WP-1250).
 *
 * @param desired {@code RUN}(그대로 일한다)·{@code DRAIN}(새 이슈를 집지 않고 멈춘다 — 꺼지는 중이거나 쉴 때 교체가 걸려
 *     있음)·{@code RESTART}(바로 다시 띄워진다 — 새 이슈를 집지 않는다)
 */
public record AgentStatusReportResponse(String desired) {

  public static final String RUN = "RUN";
  public static final String DRAIN = "DRAIN";
  public static final String RESTART = "RESTART";
}
