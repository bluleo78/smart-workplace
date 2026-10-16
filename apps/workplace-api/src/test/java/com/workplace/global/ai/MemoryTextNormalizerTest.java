package com.workplace.global.ai;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;

/** WP-385 지운 기록 정규화 — 공백·문장부호·기호 제거, 소문자, 전각 → 반각(NFKC), 300 코드포인트. */
class MemoryTextNormalizerTest {

  @Test
  void 공백과_문장부호를_걷고_소문자로_만든다() {
    assertThat(MemoryTextNormalizer.normalize("  보고서는 표로, 정리한다! ")).isEqualTo("보고서는표로정리한다");
    assertThat(MemoryTextNormalizer.normalize("Use Markdown (always)"))
        .isEqualTo("usemarkdownalways");
  }

  @Test
  void 전각_문자와_기호도_같은_문장으로_본다() {
    assertThat(MemoryTextNormalizer.normalize("ＡＢＣ→표"))
        .isEqualTo(MemoryTextNormalizer.normalize("abc 표"));
  }

  @Test
  void 비거나_null_이면_빈_문자열() {
    assertThat(MemoryTextNormalizer.normalize(null)).isEmpty();
    assertThat(MemoryTextNormalizer.normalize(" !!! ")).isEmpty();
  }

  @Test
  void 삼백_코드포인트를_넘으면_자른다() {
    String emoji = "😀".repeat(310);
    String n = MemoryTextNormalizer.normalize("가".repeat(310) + emoji);
    assertThat(n.codePointCount(0, n.length())).isEqualTo(300);
  }

  // WP-385 최종 리뷰 7: NUL 같은 제어 문자는 DB 가 받지 않는다 — 줄바꿈·탭은 남기고 나머지만 지운다.
  @Test
  void 제어_문자는_줄바꿈과_탭만_남기고_지운다() {
    assertThat(MemoryTextNormalizer.stripControl("가\u0000나\u0007\n다\t라\u007f"))
        .isEqualTo("가나\n다\t라");
    assertThat(MemoryTextNormalizer.stripControl(null)).isNull();
  }
}
