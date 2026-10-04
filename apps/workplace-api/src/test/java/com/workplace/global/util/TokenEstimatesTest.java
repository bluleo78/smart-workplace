package com.workplace.global.util;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;

/** TokenEstimates 단위 테스트(WP-232) — ASCII 4자=1토큰(올림), 비ASCII 1자=1토큰 근사와 토큰 기준 자르기. */
class TokenEstimatesTest {

  @Test
  void null_과_빈문자열은_0() {
    assertThat(TokenEstimates.estimate(null)).isZero();
    assertThat(TokenEstimates.estimate("")).isZero();
  }

  @Test
  void ASCII_는_4자당_1토큰_올림() {
    assertThat(TokenEstimates.estimate("abcd")).isEqualTo(1);
    assertThat(TokenEstimates.estimate("abcde")).isEqualTo(2);
  }

  @Test
  void 한글은_1자당_1토큰_혼합은_합산() {
    assertThat(TokenEstimates.estimate("가나다")).isEqualTo(3);
    assertThat(TokenEstimates.estimate("WP-1 가나")).isEqualTo(2 + 2); // ASCII 5자("WP-1 ")=2, 한글 2
  }

  @Test
  void 예산_이내면_원문_그대로() {
    assertThat(TokenEstimates.truncate("가나다", 3)).isEqualTo("가나다");
    assertThat(TokenEstimates.truncate(null, 3)).isNull();
  }

  @Test
  void 초과하면_접두_유지하고_생략표식_결과는_상한_이내() {
    String out = TokenEstimates.truncate("가".repeat(100), 20);
    assertThat(out).startsWith("가가가").endsWith("…(이하 생략)");
    assertThat(TokenEstimates.estimate(out)).isLessThanOrEqualTo(20);
  }
}
