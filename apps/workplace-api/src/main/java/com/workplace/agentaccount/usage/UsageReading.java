package com.workplace.agentaccount.usage;

import java.util.List;

/**
 * 조회 결과. 헤더·응답에 있던 창만 담긴다(없는 창은 호출자가 이전 값을 유지).
 *
 * @param windows 판독된 창별 스냅샷
 * @param limitReached provider 가 한도 도달을 알렸는지
 */
public record UsageReading(List<UsageSnapshot> windows, boolean limitReached) {}
