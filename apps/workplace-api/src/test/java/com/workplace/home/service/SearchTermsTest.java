package com.workplace.home.service;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;

/** WP-383 질의 → ILIKE 낱말 — 조사 뗀 형태 함께, 기호·한 글자 버림, 상한(스프링 없이 도는 순수 단위 테스트). */
class SearchTermsTest {

  @Test
  void 조사를_뗀_형태도_함께_넣는다() {
    assertThat(SearchTerms.of("고양이를 좋아해?")).containsExactly("고양이를", "고양이", "좋아해");
  }

  @Test
  void 기호와_한_글자는_버린다_빈_질의는_빈_목록() {
    assertThat(SearchTerms.of("%_ ? ㅋ a")).isEmpty();
    assertThat(SearchTerms.of(null)).isEmpty();
    assertThat(SearchTerms.of("   ")).isEmpty();
  }

  @Test
  void 영문은_소문자로_조사_떼기_없이() {
    assertThat(SearchTerms.of("Weekly Report")).containsExactly("weekly", "report");
  }

  @Test
  void 떼고_남는_것이_한_글자면_조사를_떼지_않는다() {
    assertThat(SearchTerms.of("이가")).containsExactly("이가");
  }

  @Test
  void 낱말은_상한까지만() {
    assertThat(SearchTerms.of("가나 다라 마바 사아 자차 카타 파하 거너 더러 머버", 8)).hasSize(8);
  }
}
