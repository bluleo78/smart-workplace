package com.workplace.agentruntime.service;

import com.workplace.agentruntime.outbound.AgentRuntimeDesiredChanged;
import lombok.RequiredArgsConstructor;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.stereotype.Component;

/**
 * runner 를 깨우는 한 경로(WP-1969) — 미뤄 둔 generation 이 지금 적용으로 바뀌었을 때 그 AI 의 실제 위치 runner 가 다시 조회하게
 * {@link AgentRuntimeDesiredChanged} 를 낸다. AI 상태 보고({@link AgentStatusReportService})와 칸 차단
 * 보고({@link AgentPaneReportService})가 같은 방법으로 알리도록 한 곳에 둔다.
 */
@Component
@RequiredArgsConstructor
class RunnerWakeup {

  private final AgentLocationService locationService;
  private final ApplicationEventPublisher events;

  /** 실제 위치(지정 위치 ?? 기본 위치)의 runner 에 다시 조회하라고 알린다. 위치가 하나도 없으면 알릴 곳이 없다. */
  void publishChanged(long tenantId, Long locationId) {
    Long effective = locationService.effectiveLocationId(locationId);
    if (effective != null) events.publishEvent(new AgentRuntimeDesiredChanged(tenantId, effective));
  }
}
