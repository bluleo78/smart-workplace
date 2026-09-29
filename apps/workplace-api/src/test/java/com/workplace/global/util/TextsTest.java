package com.workplace.global.util;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;

/** Texts.truncateCodePoints — 코드포인트 기준 자르기(서로게이트 쌍 보존)·말줄임표·null 처리. */
class TextsTest {

  @Test
  void truncate_keepsCodePoints() {
    assertThat(Texts.truncateCodePoints("가".repeat(130), 120)).hasSize(121).endsWith("…");
    assertThat(Texts.truncateCodePoints("짧다", 120)).isEqualTo("짧다");
  }

  @Test
  void truncate_doesNotSplitSurrogatePair() {
    // 이모지(서로게이트 쌍) 3개를 2개로 자르면 char 4개 + 말줄임표 — 반쪽 문자가 남지 않는다.
    assertThat(Texts.truncateCodePoints("😀😀😀", 2)).isEqualTo("😀😀…");
  }

  @Test
  void truncate_null_isEmpty() {
    assertThat(Texts.truncateCodePoints(null, 10)).isEmpty();
  }
}
