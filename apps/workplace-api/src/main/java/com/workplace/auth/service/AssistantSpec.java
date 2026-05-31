package com.workplace.auth.service;

/** AssistantResolver 가 caller 기준으로 해석한, compose 요청에 실릴 비서 사양. */
public record AssistantSpec(
    long agentUserId, String model, String thinkingDepth, int maxTurns, int timeoutMs) {}
