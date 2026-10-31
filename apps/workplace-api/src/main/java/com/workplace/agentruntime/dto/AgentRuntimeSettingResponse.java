package com.workplace.agentruntime.dto;

import java.util.Map;

/**
 * AI 별 실행 설정 응답(WP-1247).
 *
 * @param templateMissing 저장된 템플릿이 레지스트리에 더는 없음(템플릿을 지운 배포 뒤) — 500 대신 이 표시로 알린다
 * @param updateAvailable 저장된 템플릿 버전이 레지스트리의 현재 버전과 다름(켜거나 설정을 바꾸면 새 버전으로 고정된다)
 * @param locationId 지정한 실행 위치(null = 워크스페이스 기본 위치)
 * @param effectiveLocation 실제로 쓰는 위치(기본 해석 뒤) — 기본 위치도 없으면 null
 * @param desired 원하는 상태(켜 둠·꺼 둠)
 * @param generation 원하는 상태가 바뀔 때마다 1씩 오르는 번호
 */
public record AgentRuntimeSettingResponse(
    long agentUserId,
    String templateName,
    String templateVersion,
    boolean templateMissing,
    boolean updateAvailable,
    Long locationId,
    AgentLocationResponse effectiveLocation,
    Map<String, String> config,
    Desired desired,
    ApplyMode applyMode,
    long generation,
    AgentRuntimeStatus status,
    ObservedState observed) {}
