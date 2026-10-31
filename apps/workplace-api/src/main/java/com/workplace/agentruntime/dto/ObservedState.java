package com.workplace.agentruntime.dto;

import java.time.OffsetDateTime;

/**
 * runner·AI 가 보고한 관찰 상태(WP-1247). 이 웨이브에서는 읽기만 하고, 채우는 쪽은 웨이브 B(WP-1250)다. 보고가 없으면 칸이 모두 null.
 *
 * @param observedGeneration runner 가 마지막으로 반영한 generation
 * @param phase STARTING·RUNNING·STOPPING·STOPPED·FAILED
 * @param agentState AI 스스로 보고한 상태(IDLE·WORKING·BLOCKED)
 */
public record ObservedState(
    Long observedGeneration,
    String phase,
    String message,
    Integer cpuMillicores,
    Long memoryBytes,
    OffsetDateTime startedAt,
    OffsetDateTime observedAt,
    String agentState,
    String agentIssueKey,
    OffsetDateTime agentNextCheckAt) {}
