package com.workplace.global.util;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;

/** SingleLineTitles.normalize — 한 줄로 다듬기·앞뒤 보이지 않는 문자 제거, 그려지는 글자가 없으면 빈 문자열(WP-724). */
class SingleLineTitlesTest {

  @Test
  void collapsesLineBreaksAndTrims() {
    assertThat(SingleLineTitles.normalize("  회의\n안건\t정리 ")).isEqualTo("회의 안건 정리");
    assertThat(SingleLineTitles.normalize(null)).isNull();
  }

  @Test
  void returnsEmptyWhenNothingIsDrawn() {
    assertThat(SingleLineTitles.normalize("ㅤ")).isEmpty();
    // WP-724: 점자 빈칸·결합 문자 CGJ·변형 선택자만 있는 제목
    assertThat(SingleLineTitles.normalize("⠀⠀")).isEmpty();
    assertThat(SingleLineTitles.normalize("͏͏")).isEmpty();
    assertThat(SingleLineTitles.normalize("️")).isEmpty();
  }

  @Test
  void keepsTitlesWithVisibleCharacters() {
    assertThat(SingleLineTitles.normalize("⠀분기 계획⠀")).isEqualTo("분기 계획");
    assertThat(SingleLineTitles.normalize("🚀️ 출시")).isEqualTo("🚀️ 출시");
  }
}
