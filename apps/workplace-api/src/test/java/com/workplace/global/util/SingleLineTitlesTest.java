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

  /** WP-908: 가운데에 낀 양방향 제어 문자는 뒤 글자의 표시 순서를 뒤집으므로 지운다. */
  @Test
  void removesBidiControlsEverywhere() {
    assertThat(SingleLineTitles.normalize("n \u202Eabc")).isEqualTo("n abc");
    assertThat(SingleLineTitles.normalize("a\u202Ab\u202Bc\u202Cd\u202De\u202Ef"))
        .isEqualTo("abcdef");
    assertThat(SingleLineTitles.normalize("x\u2066y\u2067z\u2068w\u2069")).isEqualTo("xyzw");
    // 방향 제어 문자만 있으면 그려지는 글자가 없는 제목 — 빈 문자열
    assertThat(SingleLineTitles.normalize("\u202E\u202E")).isEmpty();
  }

  /** 문구·알림에 넣을 제목(WP-1069) — null·공백뿐이면 「제목 없음」, 아니면 앞뒤 공백을 뗀다. */
  @Test
  void orUntitledFallsBackForBlank() {
    assertThat(SingleLineTitles.orUntitled(null)).isEqualTo("제목 없음");
    assertThat(SingleLineTitles.orUntitled("")).isEqualTo("제목 없음");
    assertThat(SingleLineTitles.orUntitled("   ")).isEqualTo("제목 없음");
    assertThat(SingleLineTitles.orUntitled(" 로드맵 ")).isEqualTo("로드맵");
  }
}
