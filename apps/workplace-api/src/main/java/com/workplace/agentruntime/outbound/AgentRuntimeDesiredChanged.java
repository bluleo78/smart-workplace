package com.workplace.agentruntime.outbound;

/**
 * 어떤 실행 위치의 원하는 상태(켜기·끄기·설정)가 바뀌었다는 도메인 이벤트(WP-1247). 그 위치의 runner 에게 「다시 받아 가라」고 알리는 신호로 웨이브 B 가
 * 소비한다.
 *
 * @param tenantId 워크스페이스
 * @param locationId 실제 위치 id(위치를 지정하지 않은 AI 는 기본 위치로 해석한 뒤의 값)
 */
public record AgentRuntimeDesiredChanged(long tenantId, long locationId) {}
