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
 * @param failedGeneration runner 실패 기록이 있을 때 그 실패가 난 desired generation(WP-2019) — 옛 Pod 가 남아 있어
 *     observedGeneration 이 뒤처져도 새 설정의 실패를 알 수 있다. 기록이 없거나 옛 runner 면 null
 * @param podUid 지금 Pod 정체(metadata.uid) — 옛 runner 는 모르므로 없을 수 있다(null 허용)
 */
public record RunnerObservedAgent(
    @NotNull Long agentUserId,
    Long observedGeneration,
    @NotBlank @Pattern(regexp = "STARTING|RUNNING|STOPPING|STOPPED|FAILED") String phase,
    @Size(max = 500) String message,
    @PositiveOrZero Integer cpuMillicores,
    @PositiveOrZero Long memoryBytes,
    OffsetDateTime startedAt,
    @PositiveOrZero Long failedGeneration,
    @Size(max = 255) String podUid) {}
