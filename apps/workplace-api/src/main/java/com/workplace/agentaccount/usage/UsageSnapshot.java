package com.workplace.agentaccount.usage;

import java.math.BigDecimal;
import java.time.Instant;

/**
 * 한 창의 최신 사용률 스냅샷.
 *
 * @param window 5시간·주간 창
 * @param usedPercent 사용률(0~100, 소수 둘째 자리)
 * @param resetsAt 창이 리셋되는 시각(모르면 null)
 * @param limitStatus provider 가 알린 창별 상태 문구(없으면 null)
 * @param observedAt 이 값을 관측한 시각
 */
public record UsageSnapshot(
    UsageWindow window,
    BigDecimal usedPercent,
    Instant resetsAt,
    String limitStatus,
    Instant observedAt) {}
