package com.workplace.auth.service;

import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;

/**
 * 추천 질문 모델 결정(WP-139, 스펙 §10.3) — 요청에 실을 모델과 화면의 "자동 (…)" 라벨이 같은 규칙을 쓰도록 한 곳에 둔다. provider 는
 * ai_agent_credential.provider — NULL 은 레거시 anthropic(ProviderCredentialSecrets 와 같은 규칙).
 */
@Component
@RequiredArgsConstructor
public class SuggestionModelPolicy {

  private final AiSuggestionProperties properties;

  /** Anthropic 연결인가 — provider 미기록(V119 이전)은 anthropic. */
  static boolean isAnthropic(String provider) {
    return provider == null || "anthropic".equals(provider);
  }

  /** ai-agent 요청에 실을 모델 — 설정값 → Anthropic 이면 기본값 → 그 외 null(ai-agent 가 credential.model). */
  public String requestModel(String configured, String provider) {
    if (configured != null) return configured;
    return isAnthropic(provider) ? properties.suggestionDefaultModel() : null;
  }

  /**
   * 자동일 때 실제로 쓸 모델(표시용) — 연결이 없으면 null, Anthropic 이면 기본값, 그 외는 비서 모델.
   *
   * @param connected 활성 자격증명이 있는가
   */
  public String autoModel(boolean connected, String provider, String assistantModel) {
    if (!connected) return null;
    return isAnthropic(provider) ? properties.suggestionDefaultModel() : assistantModel;
  }
}
