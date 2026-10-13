package com.workplace.auth.service;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.Map;
import org.junit.jupiter.api.Test;
import org.springframework.boot.context.properties.bind.Binder;
import org.springframework.boot.context.properties.source.MapConfigurationPropertySource;

/**
 * WP-139 추천 기본 모델 설정 — application.yml 은 env WORKPLACE_AI_SUGGESTION_MODEL 을 기본값 없이 넘기므로(미설정·Helm
 * values 빈 값이면 빈 문자열) 키 누락·빈 값·공백이 모두 기본 모델로 정규화되는지 본다. 스프링 컨텍스트 없이 바인딩만 확인한다.
 */
class AiSuggestionPropertiesTest {

  private static AiSuggestionProperties bind(Map<String, String> props) {
    return new Binder(new MapConfigurationPropertySource(props))
        .bindOrCreate("workplace.ai", AiSuggestionProperties.class);
  }

  @Test
  void 값이_없으면_기본_모델() {
    assertThat(bind(Map.of()).suggestionDefaultModel()).isEqualTo("claude-haiku-5-5");
  }

  @Test
  void 빈_문자열이나_공백이면_기본_모델로_정규화한다() {
    assertThat(bind(Map.of("workplace.ai.suggestion-default-model", "")).suggestionDefaultModel())
        .isEqualTo("claude-haiku-5-5");
    assertThat(new AiSuggestionProperties("   ").suggestionDefaultModel())
        .isEqualTo("claude-haiku-5-5");
  }

  @Test
  void 지정한_값은_그대로_쓴다() {
    assertThat(
            bind(Map.of("workplace.ai.suggestion-default-model", "claude-sonnet-5-5"))
                .suggestionDefaultModel())
        .isEqualTo("claude-sonnet-5-5");
  }
}
