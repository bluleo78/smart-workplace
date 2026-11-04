package com.workplace.mail.util;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;

/** 메일 본문 앞부분 자르기 — LLM 입력 본문 길이 상한(분류 일괄·분류 교정 학습이 같은 헬퍼를 쓴다). */
class MailBodyTextTest {

  /** null·공백은 빈 문자열, 앞뒤 공백은 지운다. */
  @Test
  void head_trimsAndHandlesNull() {
    assertThat(MailBodyText.head(null, 5)).isEmpty();
    assertThat(MailBodyText.head("  안녕  ", 5)).isEqualTo("안녕");
  }

  /** 상한보다 길면 앞 max 글자(코드 포인트)만 남긴다. */
  @Test
  void head_truncatesByCodePoints() {
    assertThat(MailBodyText.head("abcdef", 3)).isEqualTo("abc");
    assertThat(MailBodyText.head("abc", 3)).isEqualTo("abc");
  }

  /** 자르는 자리에 서로게이트 쌍(이모지)이 걸려도 반쪽 문자가 남지 않는다 — 이모지는 한 글자로 센다. */
  @Test
  void head_doesNotSplitSurrogatePair() {
    String s = "ab😀cd"; // 😀 는 UTF-16 두 칸
    assertThat(MailBodyText.head(s, 3)).isEqualTo("ab😀");
    assertThat(MailBodyText.head("a😀😀", 2)).isEqualTo("a😀");
    String h = MailBodyText.head("😀😀😀", 2);
    assertThat(h).isEqualTo("😀😀");
    assertThat(Character.isHighSurrogate(h.charAt(h.length() - 1))).isFalse();
  }
}
