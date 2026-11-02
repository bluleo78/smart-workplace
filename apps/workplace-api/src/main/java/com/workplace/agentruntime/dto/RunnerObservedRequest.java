package com.workplace.agentruntime.dto;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import java.util.List;

/**
 * runner 의 관찰 상태 보고(WP-1249) — 이 위치에서 본 AI 별 Pod 상태. 한 번에 200명까지.
 *
 * @param metricsAvailable 이 위치에서 CPU·메모리 사용량을 잴 수 있는지(WP-1280) — false 는 클러스터에 사용량
 *     API(metrics-server)가 없음. null 은 이번엔 모름(일시 오류·옛 runner)이라 저장된 값을 그대로 둔다.
 */
public record RunnerObservedRequest(
    @NotNull @Size(max = 200) List<@Valid RunnerObservedAgent> agents, Boolean metricsAvailable) {

  /** 사용량 가능 여부 없이 AI 상태만 보내는 보고(옛 runner 와 같은 모양). */
  public RunnerObservedRequest(List<RunnerObservedAgent> agents) {
    this(agents, null);
  }
}
