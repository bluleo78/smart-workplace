package com.workplace.mail;

import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.mail.service.MailSensitivity;
import org.junit.jupiter.api.Test;

/** 받은 메일 기밀 판정(WP-2030) 단위 테스트 — 헤더·Graph 값 판정 규칙. */
class MailSensitivityTest {

  @Test
  void header_companyConfidential_isConfidential_caseAndSpaceInsensitive() {
    assertThat(MailSensitivity.isConfidentialHeader("Company-Confidential")).isTrue();
    assertThat(MailSensitivity.isConfidentialHeader(" company-confidential ")).isTrue();
  }

  @Test
  void header_otherValues_areNotConfidential() {
    assertThat(MailSensitivity.isConfidentialHeader("Personal")).isFalse();
    assertThat(MailSensitivity.isConfidentialHeader("Private")).isFalse();
    assertThat(MailSensitivity.isConfidentialHeader("")).isFalse();
    assertThat(MailSensitivity.isConfidentialHeader(null)).isFalse();
  }

  @Test
  void graphValue_onlyThree_isConfidential() {
    assertThat(MailSensitivity.isConfidentialGraphValue("3")).isTrue();
    assertThat(MailSensitivity.isConfidentialGraphValue(" 3 ")).isTrue();
    assertThat(MailSensitivity.isConfidentialGraphValue("2")).isFalse();
    assertThat(MailSensitivity.isConfidentialGraphValue(null)).isFalse();
  }
}
