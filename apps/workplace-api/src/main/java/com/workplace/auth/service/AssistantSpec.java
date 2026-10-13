package com.workplace.auth.service;

/**
 * AssistantResolver 가 caller 기준으로 해석한, compose 요청에 실릴 비서 사양. suggestionModel — 추천·후속 질문 요청에 실을
 * 모델(WP-139, 해석 완료: 설정값 → Anthropic 이면 API 기본값 → opencode 면 null 이라 ai-agent 가 비서 연결 모델을 쓴다).
 */
public record AssistantSpec(
    long agentUserId,
    String model,
    String thinkingDepth,
    int maxTurns,
    int timeoutMs,
    String suggestionModel) {

  /** 추천 모델 이전의 5인자 생성(기존 호출부·테스트 호환) — 추천 모델 미지정(null). */
  public AssistantSpec(
      long agentUserId, String model, String thinkingDepth, int maxTurns, int timeoutMs) {
    this(agentUserId, model, thinkingDepth, maxTurns, timeoutMs, null);
  }
}
