package com.workplace.agentruntime.dto;

import java.time.OffsetDateTime;
import java.util.List;

/**
 * runner·AI 가 보고한 관찰 상태(WP-1247). 이 웨이브에서는 읽기만 하고, 채우는 쪽은 웨이브 B(WP-1250)다. 보고가 없으면 칸이 모두 null(현재 이슈
 * 키 목록만 빈 목록).
 *
 * @param observedGeneration runner 가 마지막으로 반영한 generation
 * @param phase STARTING·RUNNING·STOPPING·STOPPED·FAILED
 * @param agentState AI 스스로 보고한 상태(IDLE·WORKING·BLOCKED) — 칸이 여럿이면 합친 상태(WP-1409)
 * @param agentIssueKey 현재 이슈 키 목록의 첫 키(옛 화면 호환)
 * @param agentIssueKeys 현재 이슈 키 모두 — 일하거나 막힌 칸들의 이슈, 칸 키 순(WP-1409, 보고 없으면 빈 목록)
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
    List<String> agentIssueKeys,
    OffsetDateTime agentNextCheckAt) {}
