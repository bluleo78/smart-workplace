package com.workplace.auth.service;

import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * AI 추천 질문 설정(WP-139). workplace.ai 키로 바인딩(@ConfigurationPropertiesScan).
 *
 * @param suggestionDefaultModel 추천 모델이 "자동"이고 비서 연결이 Anthropic 일 때 쓰는 모델(env
 *     WORKPLACE_AI_SUGGESTION_MODEL). 측정(스펙 §6.1)상 Haiku 로 3개 생성 ~0.7초.
 */
@ConfigurationProperties("workplace.ai")
public record AiSuggestionProperties(String suggestionDefaultModel) {

  /** 기본 추천 모델 — 기본값은 이 한 곳에서만 정한다(application.yml 은 env 를 비워 둔 채 넘긴다). */
  public static final String DEFAULT_MODEL = "claude-haiku-5-5";

  /**
   * 값이 없거나(키 누락) 비어 있으면(env 미설정·Helm values 빈 값 등) 기본 모델로 정규화한다 — 그대로 두면 model "" 이 ai-agent
   * zod(min 1)에 걸려 Anthropic 비서 전원의 추천·후속 질문이 조용히 실패한다.
   */
  public AiSuggestionProperties {
    suggestionDefaultModel =
        suggestionDefaultModel == null || suggestionDefaultModel.isBlank()
            ? DEFAULT_MODEL
            : suggestionDefaultModel.strip();
  }
}
