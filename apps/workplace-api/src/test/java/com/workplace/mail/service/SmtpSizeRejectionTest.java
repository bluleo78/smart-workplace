package com.workplace.mail.service;

import static org.assertj.core.api.Assertions.assertThat;

import jakarta.mail.Address;
import jakarta.mail.MessagingException;
import jakarta.mail.SendFailedException;
import org.eclipse.angus.mail.smtp.SMTPAddressFailedException;
import org.eclipse.angus.mail.smtp.SMTPSendFailedException;
import org.junit.jupiter.api.Test;

/**
 * SMTP 크기 초과 거절 판정(WP-574) — GreenMail 은 크기 제한 거절을 재현하지 못하므로 Angus 가 던지는 모양의 예외를 직접 만들어 본다. 맞으면 발송이
 * 502 가 아니라 400 「받는 메일 서버가 허용하는 크기를 넘었어요」로 끝난다.
 */
class SmtpSizeRejectionTest {

  @Test
  void dataRejectedWith552_isSizeRejection() {
    SMTPSendFailedException e =
        new SMTPSendFailedException(
            "DATA",
            552,
            "552 Message size exceeds fixed maximum message size",
            null,
            new Address[0],
            new Address[0],
            new Address[0]);
    assertThat(SmtpMailTransport.isSizeRejection(e)).isTrue();
  }

  /** 응답 코드가 다르게 실려도 확장 상태 코드 5.3.4 가 있으면 크기 거절이다(예: 554 5.3.4). */
  @Test
  void enhancedCode534_isSizeRejection() {
    SMTPSendFailedException e =
        new SMTPSendFailedException(
            "DATA",
            554,
            "554 5.3.4 Message too big for system",
            null,
            new Address[0],
            new Address[0],
            new Address[0]);
    assertThat(SmtpMailTransport.isSizeRejection(e)).isTrue();
  }

  /** 수신자별 거절이 SendFailedException 의 다음 예외 사슬에 실려 와도 찾는다. */
  @Test
  void nestedAddressFailure552_isSizeRejection() {
    SMTPAddressFailedException inner =
        new SMTPAddressFailedException(null, "RCPT TO", 552, "552 mailbox full or too large");
    SendFailedException outer = new SendFailedException("Invalid Addresses", inner);
    assertThat(SmtpMailTransport.isSizeRejection(outer)).isTrue();
  }

  /** 552 라도 확장 코드 5.2.2(받는 쪽 메일함 가득 참)는 첨부를 줄여도 풀리지 않으므로 크기 거절로 보지 않는다 — 일반 발송 실패(502)로 끝난다. */
  @Test
  void mailboxFull522_isNotSizeRejection() {
    SMTPAddressFailedException inner =
        new SMTPAddressFailedException(null, "RCPT TO", 552, "552 5.2.2 Mailbox full");
    SendFailedException outer = new SendFailedException("Invalid Addresses", inner);
    assertThat(SmtpMailTransport.isSizeRejection(outer)).isFalse();
    SMTPSendFailedException data =
        new SMTPSendFailedException(
            "DATA",
            552,
            "552 5.2.2 The email account that you tried to reach is over quota",
            null,
            new Address[0],
            new Address[0],
            new Address[0]);
    assertThat(SmtpMailTransport.isSizeRejection(data)).isFalse();
  }

  @Test
  void authFailure_isNotSizeRejection() {
    SMTPSendFailedException e =
        new SMTPSendFailedException(
            "MAIL",
            535,
            "535 5.7.8 Authentication failed",
            null,
            new Address[0],
            new Address[0],
            new Address[0]);
    assertThat(SmtpMailTransport.isSizeRejection(e)).isFalse();
    assertThat(SmtpMailTransport.isSizeRejection(new MessagingException("connect timeout")))
        .isFalse();
  }
}
