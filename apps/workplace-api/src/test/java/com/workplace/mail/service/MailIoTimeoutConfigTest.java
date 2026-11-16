package com.workplace.mail.service;

import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.mail.MailTestPorts;
import com.workplace.support.IntegrationTestBase;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

/**
 * 메일 I/O 시간 제한이 설정값({@code workplace.mail.io-timeout-ms}, WP-1641)을 따르는지 검증한다.
 *
 * <p>운영 기본은 10초로 그대로 두고, test 프로필만 2분으로 올려 테스트 JVM 이 잠시 멈춰도 메일 통합 테스트가 시간 제한으로 깨지지 않게 한다. 첨부 발송의
 * I/O 제한(2분)은 설정값이 그보다 작아도 내려가지 않아야 한다(WP-574).
 */
class MailIoTimeoutConfigTest extends IntegrationTestBase {

  @Autowired ImapConnector imapConnector;
  @Autowired MailConnectionTester connectionTester;
  @Autowired MailSentAppender sentAppender;
  @Autowired SmtpMailTransport smtpMailTransport;

  /** test 프로필(application-test.yml)의 2분이 네 클래스 모두에 주입된다. */
  @Test
  void testProfileUsesLongIoTimeout() {
    assertThat(imapConnector.ioTimeoutMs()).isEqualTo(MailTestPorts.IO_TIMEOUT_MS);
    assertThat(connectionTester.ioTimeoutMs()).isEqualTo(MailTestPorts.IO_TIMEOUT_MS);
    assertThat(sentAppender.ioTimeoutMs()).isEqualTo(MailTestPorts.IO_TIMEOUT_MS);
    assertThat(smtpMailTransport.ioTimeoutMs(false)).isEqualTo(MailTestPorts.IO_TIMEOUT_MS);
  }

  /** 설정값이 운영 기본(10초)이어도 첨부 발송 I/O 제한은 2분 아래로 내려가지 않고, 첨부가 없으면 설정값 그대로다. */
  @Test
  void attachmentTimeoutNeverBelow120s() {
    SmtpMailTransport transport = new SmtpMailTransport(null, ImapConnector.DEFAULT_TIMEOUT_MS);

    assertThat(transport.ioTimeoutMs(true)).isEqualTo(SmtpMailTransport.ATTACHMENT_IO_TIMEOUT_MS);
    assertThat(transport.ioTimeoutMs(false)).isEqualTo(10_000);
  }
}
