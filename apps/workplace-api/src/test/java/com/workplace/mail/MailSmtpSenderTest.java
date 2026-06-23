package com.workplace.mail;

import static org.assertj.core.api.Assertions.assertThat;

import com.icegreen.greenmail.configuration.GreenMailConfiguration;
import com.icegreen.greenmail.junit5.GreenMailExtension;
import com.icegreen.greenmail.util.ServerSetupTest;
import com.workplace.mail.dto.EmailAccountResponse;
import com.workplace.mail.dto.MailSecurity;
import com.workplace.mail.dto.OutgoingMail;
import com.workplace.mail.service.MailSmtpSender;
import jakarta.mail.internet.MimeMessage;
import java.time.Instant;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.RegisterExtension;

/** MailSmtpSender 단위 통합 — GreenMail SMTP(3025)로 실제 전송 후 헤더/본문 검증. */
class MailSmtpSenderTest {

  @RegisterExtension
  static GreenMailExtension greenMail =
      new GreenMailExtension(ServerSetupTest.SMTP)
          .withConfiguration(
              GreenMailConfiguration.aConfig().withUser("me@test.local", "me@test.local", "pw"));

  private final MailSmtpSender sender = new MailSmtpSender();

  private EmailAccountResponse account() {
    return new EmailAccountResponse(
        1L,
        "me@test.local",
        "보낸이",
        "127.0.0.1",
        3143,
        MailSecurity.NONE,
        "me@test.local",
        "127.0.0.1",
        3025,
        MailSecurity.NONE,
        "me@test.local",
        null,
        null,
        null,
        false,
        null);
  }

  @Test
  void send_deliversWithGivenMessageIdAndMultipart() throws Exception {
    OutgoingMail mail =
        new OutgoingMail(
            "gen-1@test.local",
            "gen-1@test.local",
            "me@test.local",
            "보낸이",
            List.of("rcpt@test.local"),
            List.of("cc@test.local"),
            List.of("bcc@test.local"),
            "테스트 제목",
            "본문 텍스트",
            "<p>본문 텍스트</p>",
            null,
            null,
            "본문 텍스트",
            Instant.now());

    sender.send(account(), "pw", mail);

    MimeMessage[] received = greenMail.getReceivedMessages();
    // To+Cc+Bcc 봉투 3명에게 전달 → 3건 기록.
    assertThat(received).hasSize(3);
    MimeMessage m = received[0];
    assertThat(m.getHeader("Message-ID")[0]).isEqualTo("<gen-1@test.local>");
    assertThat(m.getSubject()).isEqualTo("테스트 제목");
    // Bcc 는 어떤 수신 사본에도 헤더로 노출되지 않는다.
    assertThat(m.getHeader("Bcc")).isNull();
    assertThat(received).allSatisfy(copy -> assertThat(copy.getHeader("Bcc")).isNull());
    assertThat(m.getContentType()).contains("multipart/alternative");
  }

  @Test
  void send_setsReplyHeaders() throws Exception {
    OutgoingMail reply =
        new OutgoingMail(
            "r1@test.local",
            "root@test.local",
            "me@test.local",
            "보낸이",
            List.of("rcpt@test.local"),
            List.of(),
            List.of(),
            "Re: 원문",
            "답장",
            "<p>답장</p>",
            "root@test.local",
            "<root@test.local>",
            "답장",
            Instant.now());

    sender.send(account(), "pw", reply);

    MimeMessage m = greenMail.getReceivedMessages()[0];
    assertThat(m.getHeader("In-Reply-To")[0]).isEqualTo("<root@test.local>");
    assertThat(m.getHeader("References")[0]).isEqualTo("<root@test.local>");
  }
}
