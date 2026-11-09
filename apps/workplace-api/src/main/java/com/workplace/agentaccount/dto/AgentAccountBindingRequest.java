package com.workplace.agentaccount.dto;

import jakarta.validation.constraints.NotNull;

/**
 * AI → 계정 묶기 요청(WP-1448) — 이 AI 가 쓸 계정 목록의 계정 id.
 *
 * @param accountId 묶을 계정 id(이 워크스페이스의 살아 있는 계정이어야 한다)
 */
public record AgentAccountBindingRequest(@NotNull(message = "계정을 골라 주세요") Long accountId) {}
