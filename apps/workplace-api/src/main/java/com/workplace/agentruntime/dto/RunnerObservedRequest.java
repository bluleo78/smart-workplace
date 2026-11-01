package com.workplace.agentruntime.dto;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import java.util.List;

/** runner 의 관찰 상태 보고(WP-1249) — 이 위치에서 본 AI 별 Pod 상태. 한 번에 200명까지. */
public record RunnerObservedRequest(
    @NotNull @Size(max = 200) List<@Valid RunnerObservedAgent> agents) {}
