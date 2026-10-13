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
    @DefaultValue("claude-haiku-5-5") String suggestionDefaultModel) {}
