package com.workplace.global.util;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;

/**
 * Texts.truncateCodePoints — 코드포인트 기준 자르기(서로게이트 쌍 보존)·말줄임표·null 처리. Texts.headUtf16 — UTF-16 단위 앞부분
 * 자르기(서로게이트 쌍을 가르지 않음·말줄임표 없음·null 그대로).
 */
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

  @Test
  void headUtf16_서로게이트_쌍을_가르지_않고_null_은_그대로() {
    assertThat(Texts.headUtf16("ab😀", 3))
        .isEqualTo("ab"); // 😀 은 UTF-16 두 단위 — 경계가 쌍 가운데면 한 글자 덜 자른다
    assertThat(Texts.headUtf16("ab😀c", 4)).isEqualTo("ab😀");
    assertThat(Texts.headUtf16("abc", 3)).isEqualTo("abc");
    assertThat(Texts.headUtf16("abcd", 2)).isEqualTo("ab");
    assertThat(Texts.headUtf16("abc", 0)).isEmpty();
    assertThat(Texts.headUtf16(null, 3)).isNull();
  }
}
