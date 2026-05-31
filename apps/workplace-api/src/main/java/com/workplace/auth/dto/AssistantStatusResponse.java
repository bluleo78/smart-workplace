package com.workplace.auth.dto;

import java.time.Instant;

/** 개인 비서 상태(없으면 configured=false). 토큰 평문/암호문 미포함. */
public record AssistantStatusResponse(
    boolean configured,
    String tokenLabel,
    Instant tokenLastUsedAt,
    String model,
    String thinkingDepth) {}
