package com.workplace.user.dto;

import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;

/** 에이전트 실행 방식 변경 요청 — runtime 은 INTERNAL | EXTERNAL (WP-371). 빈 문자열은 패턴 불일치로 400 이 된다. */
public record SetAgentRuntimeRequest(
    @NotNull
        @Pattern(regexp = AgentRuntime.PATTERN, message = "runtime 은 INTERNAL 또는 EXTERNAL 이어야 합니다")
        String runtime) {}
