package com.workplace.messaging.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

/**
 * AI 가 채널에 올리는 쓰기 행동 제안 요청(내부 on-behalf). actionType 은 현재 "CREATE_ISSUE" 만. proposedByUserId =
 * 위임자(트리거 actor) — 승인 권한자. parentMessageId = 스레드 미러(인라인이면 null).
 */
public record CreateProposalRequest(
    @NotBlank String actionType,
    @NotBlank @Size(max = 200) String title,
    @Size(max = 10000) String body,
    @Pattern(regexp = "LOW|MID|HIGH") String priority,
    @NotNull Long proposedByUserId,
    Long parentMessageId) {}
