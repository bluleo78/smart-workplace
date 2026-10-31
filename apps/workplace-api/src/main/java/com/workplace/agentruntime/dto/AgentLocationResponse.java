package com.workplace.agentruntime.dto;

import java.time.OffsetDateTime;

/**
 * AI 실행 위치 응답(WP-1248). 토큰 평문은 담지 않는다(발급 응답 {@link AgentLocationTokenResponse} 에서만).
 *
 * @param isDefault 위치를 지정하지 않은 AI 가 가는 기본 위치인지
 * @param capacity 동시에 켤 수 있는 AI 수(자리)
 * @param used 지금 그 위치에서 켜져 있는(원하는 상태 RUN) AI 수
 * @param lastSeenAt runner 토큰의 마지막 사용 시각(없으면 null)
 * @param tokenPrefix 쓸 수 있는 토큰의 앞 12자(알아보기용, 없으면 null)
 */
public record AgentLocationResponse(
    long id,
    String name,
    String description,
    boolean isDefault,
    int capacity,
    int used,
    LocationConnection connection,
    OffsetDateTime lastSeenAt,
    String tokenPrefix) {}
