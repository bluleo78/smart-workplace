package com.workplace.global.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

/**
 * AI 진행(progress) 알림의 단계 한 줄 — 「위키 검색 · running」. {@link AiProgressRequest} 의 steps 원소.
 *
 * <p>상한(WP-1191): 진행 알림은 저장되지 않고 멤버 전원의 SSE 로 바로 나가므로 단계 수({@link #MAX_STEPS})·문구 길이({@link
 * #MAX_LABEL})를 묶고, 상태는 웹이 그리는 두 값(running·done)만 받는다. ai-agent 는 최근 단계만 보내 이 상한 안에 든다
 * (ProgressTracker.snapshot). 문구는 도구 이름 수준(수십 자)이다.
 */
public record AiProgressStep(
    @NotBlank @Size(max = MAX_LABEL, message = "진행 단계 문구는 " + MAX_LABEL + "자 이하여야 합니다")
        String label,
    @NotNull @Pattern(regexp = "running|done", message = "진행 단계 상태 값이 올바르지 않습니다") String status) {

  /** 한 알림에 실을 수 있는 단계 수. */
  public static final int MAX_STEPS = 100;

  /** 단계 문구 길이 상한. */
  public static final int MAX_LABEL = 200;
}
