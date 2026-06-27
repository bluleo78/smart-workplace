package com.workplace.mail.util;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;

/** MailContentHash 단위 테스트 — null-safe, 결정적(동일 입력 동일 해시), 구분자 길이 확인. */
class MailContentHashTest {

  @Test
  void sameBodyProducesSameHash_nullSafe() {
    // null 정규화: null html 은 빈 문자열로 처리
    String a = MailContentHash.of("hello", null);
    String b = MailContentHash.of("hello", null);
    assertThat(a).isEqualTo(b).hasSize(64);
    // 입력이 다르면 해시도 달라야 한다
    assertThat(MailContentHash.of(null, "<p>x</p>")).isNotEqualTo(a);
  }

  @Test
  void separatorPreventsCollision() {
    // "ab" + "" ≠ "a" + "b" : \000 구분자가 ambiguity 방지
    String h1 = MailContentHash.of("ab", "");
    String h2 = MailContentHash.of("a", "b");
    assertThat(h1).isNotEqualTo(h2);
  }

  @Test
  void bothNullProducesConsistentHash() {
    // 두 null 은 "\000" 만인 문자열로 정규화 → 동일 해시
    String h1 = MailContentHash.of(null, null);
    String h2 = MailContentHash.of(null, null);
    assertThat(h1).isEqualTo(h2).hasSize(64);
  }
}
