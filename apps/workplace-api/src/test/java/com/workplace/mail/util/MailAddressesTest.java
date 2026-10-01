package com.workplace.mail.util;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;

/** WP-149 수신자 헤더 파싱 — IMAP(표시 이름·RFC 2047)·Graph(주소만) 두 저장 형식 모두. */
class MailAddressesTest {

  @Test
  void imapFormat_withCommaInDisplayName() {
    assertThat(MailAddresses.parseList("\"Kim, Minsu\" <Minsu@Acme.com>, gd@gmail.com"))
        .containsExactly("minsu@acme.com", "gd@gmail.com");
  }

  @Test
  void rfc2047EncodedName() {
    assertThat(MailAddresses.parseList("=?UTF-8?B?6rmA66+87IiY?= <m@a.com>"))
        .containsExactly("m@a.com");
  }

  @Test
  void graphFormat_plainAddresses() {
    assertThat(MailAddresses.parseList("a@x.com, B@y.com")).containsExactly("a@x.com", "b@y.com");
  }

  @Test
  void blankOrNull_isEmpty() {
    assertThat(MailAddresses.parseList(null)).isEmpty();
    assertThat(MailAddresses.parseList("  ")).isEmpty();
  }

  @Test
  void malformed_fallsBackToRegex() {
    assertThat(MailAddresses.parseList("a@x.com, <broken")).containsExactly("a@x.com");
  }

  @Test
  void duplicates_removed() {
    assertThat(MailAddresses.parseList("a@x.com, A@X.com")).containsExactly("a@x.com");
  }
}
