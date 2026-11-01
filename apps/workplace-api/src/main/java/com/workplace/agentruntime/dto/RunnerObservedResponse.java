package com.workplace.agentruntime.dto;

import java.util.List;

/**
 * 관찰 보고 결과(WP-1249).
 *
 * @param updated 반영한 AI 수
 * @param ignored 반영하지 않은 AI id — 없는 AI 이거나 실제 위치가 이 위치가 아닌 AI
 */
public record RunnerObservedResponse(int updated, List<Long> ignored) {}
