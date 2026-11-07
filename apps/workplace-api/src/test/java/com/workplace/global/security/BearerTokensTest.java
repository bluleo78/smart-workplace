package com.workplace.global.security;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;

/**
 * {@link BearerTokens#extract} 판정 규칙 단위 테스트(WP-1431). scheme 은 대소문자 무관(RFC 7235)이고, scheme 뒤 공백·빈
 * 토큰·다른 scheme 의 경계를 확인한다. 실제 HTTP 인증 흐름은 {@link BearerSchemeCaseInsensitiveTest} 가 본다.
 */
class BearerTokensTest {

  @Test
  void scheme_is_case_insensitive() {
    assertThat(BearerTokens.extract("Bearer abc")).isEqualTo("abc");
    assertThat(BearerTokens.extract("bearer abc")).isEqualTo("abc");
    assertThat(BearerTokens.extract("BEARER abc")).isEqualTo("abc");
    assertThat(BearerTokens.extract("bEaReR abc")).isEqualTo("abc");
  }

  /**
   * 대소문자 말고는 넓히지 않는다 — 구분 공백은 정확히 하나, 토큰은 다듬지 않는다. 여러 공백·토큰 뒤 공백은 그대로 토큰에 남아(뒤 단계 매칭 실패), 탭은 구분자가
   * 아니다.
   */
  @Test
  void extra_whitespace_is_not_trimmed_and_tab_is_not_separator() {
    assertThat(BearerTokens.extract("Bearer  abc")).isEqualTo(" abc");
    assertThat(BearerTokens.extract("Bearer abc  ")).isEqualTo("abc  ");
    assertThat(BearerTokens.extract("Bearer\tabc")).isNull();
  }

  @Test
  void non_bearer_or_missing_token_is_null() {
    assertThat(BearerTokens.extract(null)).isNull();
    assertThat(BearerTokens.extract("")).isNull();
    assertThat(BearerTokens.extract("Bearer")).isNull();
    assertThat(BearerTokens.extract("bearer ")).isNull();
    // scheme 뒤 공백이 없으면 다른 scheme 이다.
    assertThat(BearerTokens.extract("Bearerabc")).isNull();
    assertThat(BearerTokens.extract("Basic dXNlcjpwYXNz")).isNull();
    assertThat(BearerTokens.extract("Internal abc")).isNull();
  }
}
