package com.workplace.user.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;

/** 에이전트 실행 방식 변경 요청 — runtime 은 INTERNAL | EXTERNAL (WP-371). */
public record SetAgentRuntimeRequest(
    @NotBlank
        @Pattern(regexp = "INTERNAL|EXTERNAL", message = "runtime 은 INTERNAL 또는 EXTERNAL 이어야 합니다")
        String runtime) {}
