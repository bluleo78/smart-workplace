package com.workplace.global.dto;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import java.util.List;

/**
 * AI 진행(progress) 알림 요청 본문 — streamId/phase/steps. 채널·이슈 채팅 진행 알림이 같이 쓰고, ai-agent 의 Internal 대행
 * 호출만 받는다(WP-1191).
 *
 * <p>저장되지 않고 멤버 전원의 SSE 로 바로 나가므로 크기와 값을 묶는다 — 단계 수 {@link AiProgressStep#MAX_STEPS} 개, phase 는
 * ai-agent 가 보내는 네 값(started·tool·done·error)만.
 */
public record AiProgressRequest(
    @Size(max = 100) String streamId,
    @Pattern(regexp = "started|tool|done|error", message = "진행 단계(phase) 값이 올바르지 않습니다")
        String phase,
    @Size(
            max = AiProgressStep.MAX_STEPS,
            message = "진행 단계는 " + AiProgressStep.MAX_STEPS + "개 이하여야 합니다")
        List<@NotNull @Valid AiProgressStep> steps) {

  /** 사람 JWT·PAT·AI 키로 부르면 돌려주는 403 문구 — ai-agent 대행 호출만 받는다. */
  public static final String INTERNAL_ONLY_MESSAGE = "AI 진행 알림은 내부 호출만 보낼 수 있습니다";
}
