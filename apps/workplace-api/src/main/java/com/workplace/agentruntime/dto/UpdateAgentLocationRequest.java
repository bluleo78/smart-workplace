package com.workplace.agentruntime.dto;

import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

/** AI 실행 위치 수정 요청(WP-1248) — 이름·설명·자리 수를 통째로 바꾼다(기본 여부는 별도 API). */
public record UpdateAgentLocationRequest(
    @NotBlank @Size(max = 64) String name,
    @Size(max = 200) String description,
    @NotNull @Min(1) @Max(100) Integer capacity) {}
