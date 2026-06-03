package com.workplace.mail;

import static org.assertj.core.api.Assertions.assertThat;

import com.icegreen.greenmail.configuration.GreenMailConfiguration;
import com.icegreen.greenmail.junit5.GreenMailExtension;
import com.icegreen.greenmail.util.ServerSetupTest;
import com.workplace.mail.dto.ConnectionTestResult;
import com.workplace.mail.dto.MailSecurity;
import com.workplace.mail.service.MailConnectionTester;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.RegisterExtension;

/**
 * MailConnectionTester 의 IMAP/SMTP 실연결 검증. GreenMail(SMTP 3025 / IMAP 3143, 평문)에 사용자
 * u@test.local/pw 를 미리 등록하고 NONE 보안으로 접속한다.
 */
class MailConnectionTesterTest {

  @RegisterExtension
  static GreenMailExtension greenMail =
      new GreenMailExtension(ServerSetupTest.SMTP_IMAP)
          .withConfiguration(
              GreenMailConfiguration.aConfig().withUser("u@test.local", "u@test.local", "pw"));

  private final MailConnectionTester tester = new MailConnectionTester();

  @Test
  void success_whenCredentialsValid() {
    ConnectionTestResult r =
        tester.test(
            "127.0.0.1", 3143, MailSecurity.NONE, "u@test.local",
            "127.0.0.1", 3025, MailSecurity.NONE, "u@test.local",
            "pw");
    assertThat(r.success()).isTrue();
    assertThat(r.imapOk()).isTrue();
    assertThat(r.smtpOk()).isTrue();
  }

  @Test
  void imapFails_whenBadPassword() {
    ConnectionTestResult r =
        tester.test(
            "127.0.0.1", 3143, MailSecurity.NONE, "u@test.local",
            "127.0.0.1", 3025, MailSecurity.NONE, "u@test.local",
            "wrong-pw");
    assertThat(r.imapOk()).isFalse();
    assertThat(r.imapError()).isNotNull();
  }

  @Test
  void imapFails_whenHostUnreachable() {
    ConnectionTestResult r =
        tester.test(
            "127.0.0.1", 1, MailSecurity.NONE, "u@test.local",
            "127.0.0.1", 3025, MailSecurity.NONE, "u@test.local",
            "pw");
    assertThat(r.imapOk()).isFalse();
    assertThat(r.imapError()).isNotNull();
  }
}
