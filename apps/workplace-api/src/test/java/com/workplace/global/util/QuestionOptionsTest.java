package com.workplace.global.util;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.Arrays;
import java.util.List;
import org.junit.jupiter.api.Test;

/** WP-1569 질문 답 선택지 정리·검증 규칙 — report_agent_work 검증과 서버 보완 추출이 함께 쓰는 순수 함수. */
class QuestionOptionsTest {

  @Test
  void 정리는_앞뒤_공백을_지우고_빈_값과_중복을_순서를_지키며_뺀다() {
    assertThat(QuestionOptions.normalize(Arrays.asList("  A안 ", "", null, "B안", "A안", "   ")))
        .containsExactly("A안", "B안");
  }

  @Test
  void 정리는_null_이면_빈_목록() {
    assertThat(QuestionOptions.normalize(null)).isEmpty();
  }

  @Test
  void 유효는_2개에서_4개까지() {
    assertThat(QuestionOptions.isValid(List.of("a"))).isFalse();
    assertThat(QuestionOptions.isValid(List.of("a", "b"))).isTrue();
    assertThat(QuestionOptions.isValid(List.of("a", "b", "c", "d"))).isTrue();
    assertThat(QuestionOptions.isValid(List.of("a", "b", "c", "d", "e"))).isFalse();
    assertThat(QuestionOptions.isValid(null)).isFalse();
  }

  @Test
  void 유효는_각_40자_이하이고_이모지는_한_글자로_센다() {
    String forty = "가".repeat(40);
    assertThat(QuestionOptions.isValid(List.of(forty, "b"))).isTrue();
    assertThat(QuestionOptions.isValid(List.of(forty + "나", "b"))).isFalse();
    // 이모지(서로게이트 쌍) 40개 = UTF-16 80 단위지만 40자다.
    assertThat(QuestionOptions.isValid(List.of("😀".repeat(40), "b"))).isTrue();
  }

  @Test
  void 추출_결과는_긴_것을_버리고_앞에서_4개까지만_남긴다() {
    assertThat(
            QuestionOptions.fromExtracted(
                List.of("A안", "x".repeat(41), " B안 ", "C안", "A안", "D안", "E안")))
        .containsExactly("A안", "B안", "C안", "D안");
  }

  @Test
  void 추출_결과가_2개_미만이면_빈_목록() {
    assertThat(QuestionOptions.fromExtracted(List.of("A안", "A안 ", "x".repeat(41)))).isEmpty();
    assertThat(QuestionOptions.fromExtracted(List.of())).isEmpty();
    assertThat(QuestionOptions.fromExtracted(null)).isEmpty();
  }
}
