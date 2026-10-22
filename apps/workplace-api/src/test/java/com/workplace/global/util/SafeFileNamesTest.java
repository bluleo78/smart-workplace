package com.workplace.global.util;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import org.junit.jupiter.api.Test;

/** SafeFileNames 길이 규칙(WP-561) — 저장 칸(255자)에 맞춰 업로드 이름은 줄이고, 사용자가 짓는 이름은 거절한다. */
class SafeFileNamesTest {

  @Test
  void fitLength_keepsShortNameAsIs() {
    assertThat(SafeFileNames.fitLength("보고서.pdf")).isEqualTo("보고서.pdf");
    assertThat(SafeFileNames.fitLength("a".repeat(255))).hasSize(255);
  }

  @Test
  void fitLength_cutsBaseAndKeepsExtension() {
    String fitted = SafeFileNames.fitLength("a".repeat(300) + ".png");
    assertThat(fitted).hasSize(255).endsWith(".png").startsWith("aaaa");
  }

  @Test
  void fitLength_countsCodePoints_andDoesNotSplitSurrogatePair() {
    String fitted = SafeFileNames.fitLength("😀".repeat(300) + ".txt");
    assertThat(fitted.codePointCount(0, fitted.length())).isEqualTo(255);
    assertThat(fitted).endsWith(".txt").doesNotContain("�");
    assertThat(Character.isHighSurrogate(fitted.charAt(fitted.length() - 5))).isFalse();
  }

  @Test
  void fitLength_withoutUsableExtension_cutsWholeName() {
    assertThat(SafeFileNames.fitLength("b".repeat(300))).hasSize(255);
    // 확장자처럼 보이는 꼬리가 너무 길면 확장자로 보지 않는다.
    assertThat(SafeFileNames.fitLength("c".repeat(100) + "." + "d".repeat(200))).hasSize(255);
  }

  @Test
  void sanitize_fitsLength() {
    assertThat(SafeFileNames.sanitize("x".repeat(400) + ".docx", "file"))
        .hasSize(255)
        .endsWith(".docx");
  }

  @Test
  void validate_rejectsNameLongerThan255() {
    assertThat(SafeFileNames.validate("가".repeat(255), "파일")).hasSize(255);
    assertThatThrownBy(() -> SafeFileNames.validate("가".repeat(256), "폴더"))
        .isInstanceOf(IllegalArgumentException.class)
        .hasMessageContaining("255자");
  }

  /** WP-781: 보이지 않는 글자(제로폭·점자 빈칸·한글 채움)뿐인 업로드 이름은 fallback, 보이는 글자가 있으면 그대로. */
  @Test
  void sanitize_invisibleOnlyName_fallsBack() {
    assertThat(SafeFileNames.sanitize("\u200B\u2800", "file")).isEqualTo("file");
    assertThat(SafeFileNames.sanitize("\u3164", "file")).isEqualTo("file");
    assertThat(SafeFileNames.sanitize("\u200B보고서.pdf", "file")).isEqualTo("\u200B보고서.pdf");
  }
}
