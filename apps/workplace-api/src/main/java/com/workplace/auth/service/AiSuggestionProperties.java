package com.workplace.auth.service;

import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.boot.context.properties.bind.DefaultValue;

/**
 * AI 추천 질문 설정(WP-139). workplace.ai 키로 바인딩(@ConfigurationPropertiesScan).
 *
 * @param suggestionDefaultModel 추천 모델이 "자동"이고 비서 연결이 Anthropic 일 때 쓰는 모델(env
 *     WORKPLACE_AI_SUGGESTION_MODEL). 측정(스펙 §6.1)상 Haiku 로 3개 생성 ~0.7초.
 */
@ConfigurationProperties("workplace.ai")
public record AiSuggestionProperties(
    @DefaultValue(AiSuggestionProperties.DEFAULT_MODEL) String suggestionDefaultModel) {

  /** 기본 추천 모델. */
  public static final String DEFAULT_MODEL = "claude-haiku-5-5";

  /**
   * env 가 정의만 되고 비어 있으면(Helm values 빈 값 등) `${WORKPLACE_AI_SUGGESTION_MODEL:…}` 이 기본값이 아니라 빈 문자열로
   * 풀린다 — 그대로 두면 model "" 이 ai-agent zod(min 1)에 걸려 Anthropic 비서 전원의 추천·후속 질문이 조용히 실패한다. 빈 값·공백은
   * 기본값으로 되돌린다(최종 리뷰 M2).
   */
  public AiSuggestionProperties {
    suggestionDefaultModel =
        suggestionDefaultModel == null || suggestionDefaultModel.isBlank()
            ? DEFAULT_MODEL
            : suggestionDefaultModel.strip();
  }
}
