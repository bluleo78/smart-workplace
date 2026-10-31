package com.workplace.agentruntime.dto;

import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

/**
 * AI 실행 위치 생성 요청(WP-1248).
 *
 * @param capacity 동시에 켤 수 있는 AI 수(1~100). 비우면 3.
 */
public record CreateAgentLocationRequest(
    @NotBlank @Size(max = 64) String name,
    @Size(max = 200) String description,
    @Min(1) @Max(100) Integer capacity) {}
