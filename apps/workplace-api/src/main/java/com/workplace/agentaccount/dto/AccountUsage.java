package com.workplace.agentaccount.dto;

import java.math.BigDecimal;
import java.time.Instant;

/**
 * AI 계정 사용량 블록(WP-1449) — 계정 목록 응답에 싣는 5시간·주간 사용량과 상태, 마지막 조회·성공 시각, 마지막 실패 이유, 마지막 사용 시각. 토큰 등 원문은
 * 싣지 않는다 — 실패 이유도 코드와 짧은 한국어 문구뿐이다.
 *
 * @param status OK·NEAR_LIMIT·LIMIT_REACHED·CHECK_FAILED·RELOGIN_REQUIRED·UNLIMITED·UNKNOWN
 * @param fiveHour 5시간 창(아직 값이 없으면 null)
 * @param weekly 주간 창(아직 값이 없으면 null)
 * @param checkedAt 마지막 조회 시도 시각
 * @param succeededAt 마지막 조회 성공 시각
 * @param errorCode 마지막 시도가 실패했으면 그 코드(성공했으면 null)
 * @param errorMessage 실패 이유의 짧은 한국어 문구
 * @param lastUsedAt 이 계정을 쓰는 AI 의 Pod 가 마지막으로 RUNNING 으로 보고된 시각
 */
public record AccountUsage(
    String status,
    Window fiveHour,
    Window weekly,
    Instant checkedAt,
    Instant succeededAt,
    String errorCode,
    String errorMessage,
    Instant lastUsedAt) {

  /**
   * 사용량 창 하나.
   *
   * @param usedPercent 사용률(0~100, 소수 둘째 자리)
   * @param resetsAt 창이 초기화되는 시각
   * @param observedAt 이 값을 읽은 시각
   */
  public record Window(BigDecimal usedPercent, Instant resetsAt, Instant observedAt) {}
}
