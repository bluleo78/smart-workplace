package com.workplace.agentruntime.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.PositiveOrZero;
import jakarta.validation.constraints.Size;
import java.time.OffsetDateTime;

/**
 * 관찰 보고의 AI 한 명(WP-1249). phase 는 DB CHECK 와 같은 다섯 값만 받는다 — 틀린 값이 500(제약 위반) 대신 400 이 되게.
 *
 * @param observedGeneration 지금 떠 있는 Pod 가 반영한 generation(Pod 가 없으면 null 가능)
 * @param phase STARTING·RUNNING·STOPPING·STOPPED·FAILED
 * @param message 실패 사유 등 짧은 설명
 */
public record RunnerObservedAgent(
    @NotNull Long agentUserId,
    Long observedGeneration,
    @NotBlank @Pattern(regexp = "STARTING|RUNNING|STOPPING|STOPPED|FAILED") String phase,
    @Size(max = 500) String message,
    @PositiveOrZero Integer cpuMillicores,
    @PositiveOrZero Long memoryBytes,
    OffsetDateTime startedAt) {}
