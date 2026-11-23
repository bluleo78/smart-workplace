package com.workplace.mail;

import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.mail.service.ConfidentialSubject;
import org.junit.jupiter.api.Test;

/** WP-2029: 기밀 제목 머리말 규칙 — 앞에 붙이되 이미 있으면 그대로, 빈 제목은 머리말만. */
class ConfidentialSubjectTest {

  @Test
  void apply_prefixesPlainSubject() {
    assertThat(ConfidentialSubject.apply("단가 협상안")).isEqualTo("[기밀] 단가 협상안");
  }

  @Test
  void apply_keepsSubjectThatAlreadyContainsPrefix() {
    assertThat(ConfidentialSubject.apply("RE: [기밀] 단가")).isEqualTo("RE: [기밀] 단가");
    assertThat(ConfidentialSubject.apply("[기밀] 견적")).isEqualTo("[기밀] 견적");
  }

  @Test
  void apply_blankSubjectBecomesPrefixOnly() {
    assertThat(ConfidentialSubject.apply(null)).isEqualTo("[기밀]");
    assertThat(ConfidentialSubject.apply("")).isEqualTo("[기밀]");
    assertThat(ConfidentialSubject.apply("   ")).isEqualTo("[기밀]");
  }
}
