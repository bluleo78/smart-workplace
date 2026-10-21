package com.workplace.global.util;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import org.junit.jupiter.api.Test;

/**
 * PersonNames.normalize(WP-572) — 사람 이름의 앞뒤 공백·보이지 않는 문자 다듬기, 비거나 보이지 않는 문자만 남은 이름 거절, 줄바꿈·탭 같은 제어
 * 문자·양방향 제어 문자 거절.
 */
class PersonNamesTest {

  @Test
  void trimsSpacesAndInvisibleEdges() {
    assertThat(PersonNames.normalize("  김지훈  ")).isEqualTo("김지훈");
    // 전각 공백·제로폭 공백·BOM 도 앞뒤에서 지운다.
    assertThat(PersonNames.normalize("　​정하늘﻿ ")).isEqualTo("정하늘");
  }

  @Test
  void keepsInnerSpaces() {
    assertThat(PersonNames.normalize(" Jane  Doe ")).isEqualTo("Jane  Doe");
  }

  @Test
  void normalizesToNfc() {
    // 분해형(NFD) 「한」 → 합성형(NFC)
    assertThat(PersonNames.normalize("한")).isEqualTo("한");
  }

  @Test
  void rejectsBlankOrInvisibleOnly() {
    assertThatThrownBy(() -> PersonNames.normalize("   "))
        .isInstanceOf(IllegalArgumentException.class)
        .hasMessage("이름을 입력해 주세요");
    assertThatThrownBy(() -> PersonNames.normalize("​​"))
        .isInstanceOf(IllegalArgumentException.class)
        .hasMessage("이름을 입력해 주세요");
    assertThatThrownBy(() -> PersonNames.normalize(null))
        .isInstanceOf(IllegalArgumentException.class)
        .hasMessage("이름을 입력해 주세요");
  }

  @Test
  void rejectsNamesWithoutAnyDrawnCharacter_wp724() {
    // 점자 빈칸(U+2800, So)·결합 문자 CGJ(U+034F, Mn)·변형 선택자(U+FE0F, Mn) — 공백이 아니어도 화면에 아무것도 그려지지 않는다.
    for (String raw :
        new String[] {"\u2800\u2800", "\u034F\u034F", "\uFE0F", " \u2800\u034F\uFE0F "}) {
      assertThatThrownBy(() -> PersonNames.normalize(raw))
          .as(raw.codePoints().mapToObj(Integer::toHexString).toList().toString())
          .isInstanceOf(IllegalArgumentException.class)
          .hasMessage("이름을 입력해 주세요");
    }
  }

  @Test
  void keepsMeaningfulMarksAndTrimsBrailleBlankEdges_wp724() {
    // 점자 빈칸은 앞뒤에서 지운다.
    assertThat(PersonNames.normalize("\u2800김지훈\u2800")).isEqualTo("김지훈");
    // 결합 문자는 앞 글자에 붙어 뜻이 있으므로 남긴다(힌디 「क्」, 이모지 변형 선택자).
    assertThat(PersonNames.normalize("क्")).isEqualTo("क्");
    assertThat(PersonNames.normalize("하트❤\uFE0F")).isEqualTo("하트❤\uFE0F");
  }

  @Test
  void rejectsControlAndBidiChars() {
    assertThatThrownBy(() -> PersonNames.normalize("a\nb\tc"))
        .isInstanceOf(IllegalArgumentException.class)
        .hasMessage("이름에 줄바꿈·탭 같은 제어 문자는 쓸 수 없습니다");
    // 오른쪽→왼쪽 덮어쓰기(U+202E)는 표시 순서를 뒤집어 다른 사람처럼 보이게 할 수 있다.
    assertThatThrownBy(() -> PersonNames.normalize("관리‮자"))
        .isInstanceOf(IllegalArgumentException.class)
        .hasMessage("이름에 줄바꿈·탭 같은 제어 문자는 쓸 수 없습니다");
  }
}
