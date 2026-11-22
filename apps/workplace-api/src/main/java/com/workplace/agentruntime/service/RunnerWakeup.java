package com.workplace.agentruntime.service;

import com.workplace.agentruntime.outbound.AgentRuntimeDesiredChanged;
import lombok.RequiredArgsConstructor;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.stereotype.Component;

/**
 * runner 를 깨우는 한 경로(WP-1969) — runner 가 읽는 적용 판정({@link RolloutPolicy#decide})이 지금 적용이 아니던 것에서 지금
 * 적용(NOW)으로 바뀌면 그 AI 의 실제 위치 runner 가 다시 조회하게 {@link AgentRuntimeDesiredChanged} 를 낸다. 세 보고 경로 — AI
 * 상태 보고({@link AgentStatusReportService}), 칸 차단·OK 보고({@link AgentPaneReportService}), runner 관찰
 * 보고({@link RunnerDesiredStateService#observed}) — 가 같은 판정·같은 방법으로 알리도록 한 곳에 둔다. 화면에 보이는 판정({@link
 * RolloutPolicy#pending})은 깨우기가 아니라 화면 알림의 기준이다.
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
