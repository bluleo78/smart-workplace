package com.workplace.agentruntime.dto;

import jakarta.validation.constraints.PositiveOrZero;

/**
 * runner 가 본 네임스페이스 쿼터 수용량(WP-1819).
 *
 * @param capacity 쿼터로 띄울 수 있는 AI 수. null 은 쿼터가 없음(제한 없음)
 */
public record RunnerQuota(@PositiveOrZero Integer capacity) {}
