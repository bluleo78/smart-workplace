package com.workplace.mail.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.workplace.mail.exception.MailValidationException;
import jakarta.mail.Address;
import jakarta.mail.MessagingException;
import jakarta.mail.SendFailedException;
import jakarta.mail.Session;
import jakarta.mail.Transport;
import jakarta.mail.internet.MimeMessage;
import java.io.BufferedReader;
import java.io.ByteArrayOutputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.ServerSocket;
import java.net.Socket;
import java.nio.charset.StandardCharsets;
import java.util.Properties;
import org.eclipse.angus.mail.smtp.SMTPAddressFailedException;
import org.eclipse.angus.mail.smtp.SMTPSendFailedException;
import org.junit.jupiter.api.Test;

/**
 * SMTP 크기 초과 거절 판정(WP-574) — GreenMail 은 크기 제한 거절을 재현하지 못하므로 Angus 가 던지는 모양의 예외를 직접 만들어 본다. 맞으면 발송이
 * 502 가 아니라 400 「받는 메일 서버가 허용하는 크기를 넘었어요」로 끝난다.
 *
 * <p>WP-1329: 연결 뒤 EHLO SIZE 확장으로 서버 한도를 읽어 보내기 전에 거절하는 사전 판정 — EHLO 만 답하는 작은 가짜 SMTP 서버로 본다.
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

  // ---- WP-1329: EHLO SIZE 사전 판정 ----

  @Test
  void parseSizeLimit_handlesMissingZeroAndGarbage() {
    assertThat(SmtpMailTransport.parseSizeLimit(null)).isZero();
    assertThat(SmtpMailTransport.parseSizeLimit("")).isZero();
    assertThat(SmtpMailTransport.parseSizeLimit("0")).isZero();
    assertThat(SmtpMailTransport.parseSizeLimit("abc")).isZero();
    assertThat(SmtpMailTransport.parseSizeLimit(" 26214400 ")).isEqualTo(26214400L);
  }

  @Test
  void messages_showBothSizesInMbWithOneDecimal() {
    assertThat(SmtpMailTransport.sizeExceededMessage(25L * 1024 * 1024, 28_730_000L, true))
        .isEqualTo(
            "메일 서버가 허용하는 크기(25.0MB)를 넘었어요(이 메일 27.4MB — 첨부는 전송 중 약 1.37배 커져요)."
                + " 첨부를 줄이거나 나눠서 보내 주세요");
    // 한도는 내림·메일은 올림 — 1바이트 넘어도 두 수가 같아 보이지 않는다. 첨부가 없으면 배율 안내를 빼다.
    assertThat(SmtpMailTransport.sizeExceededMessage(10_000_000L, 10_000_001L, false))
        .isEqualTo("메일 서버가 허용하는 크기(9.5MB)를 넘었어요(이 메일 9.6MB). 첨부를 줄이거나 나눠서 보내 주세요");
    // 552 거절 — 잰 크기가 있으면 함께, 없으면 기존 문구
    assertThat(SmtpMailTransport.sizeRejectedMessage(28_730_000L, true)).contains("이 메일 27.4MB");
    assertThat(SmtpMailTransport.sizeRejectedMessage(-1, true))
        .isEqualTo(SmtpMailTransport.SIZE_REJECTED_MESSAGE);
  }

  /** 잰 크기는 실제로 쓰이는 바이트(writeTo)와 같다. */
  @Test
  void measure_equalsWrittenBytes() throws Exception {
    MimeMessage msg = message(5000);
    ByteArrayOutputStream out = new ByteArrayOutputStream();
    msg.writeTo(out);
    assertThat(SmtpMailTransport.measure(msg)).isEqualTo(out.size());
  }

  /** 서버가 알린 SIZE 를 넘는 메일은 MAIL FROM 전에 두 크기를 담은 400 문구로 거절한다. */
  @Test
  void serverSizeAdvertised_overLimit_rejectedBeforeSend() throws Exception {
    try (FakeEhloServer server = new FakeEhloServer("250-SIZE 1000")) {
      Transport t = server.connect();
      try {
        assertThatThrownBy(() -> SmtpMailTransport.requireWithinServerSize(t, message(5000)))
            .isInstanceOf(MailValidationException.class)
            .hasMessageContaining("메일 서버가 허용하는 크기(0.0MB)를 넘었어요(이 메일 ");
      } finally {
        t.close();
      }
    }
  }

  /** 한도 안이면 통과하고 잰 크기를 돌려준다(552 안내에 재사용). */
  @Test
  void serverSizeAdvertised_withinLimit_returnsMeasuredSize() throws Exception {
    try (FakeEhloServer server = new FakeEhloServer("250-SIZE 1000000")) {
      Transport t = server.connect();
      try {
        MimeMessage msg = message(5000);
        assertThat(SmtpMailTransport.requireWithinServerSize(t, msg))
            .isEqualTo(SmtpMailTransport.measure(msg));
      } finally {
        t.close();
      }
    }
  }

  /** SIZE 를 알리지 않거나 0(한도 없음)이면 재지 않고 넘긴다 — 기존 552 거절 경로가 그대로 판정한다. */
  @Test
  void serverSizeNotAdvertisedOrZero_skipsCheck() throws Exception {
    for (String ext : new String[] {"250-8BITMIME", "250-SIZE 0", "250-SIZE"}) {
      try (FakeEhloServer server = new FakeEhloServer(ext)) {
        Transport t = server.connect();
        try {
          assertThat(SmtpMailTransport.requireWithinServerSize(t, message(5000))).isEqualTo(-1);
        } finally {
          t.close();
        }
      }
    }
  }

  /** 본문 n 바이트짜리 단순 메일. */
  private static MimeMessage message(int bodyBytes) throws MessagingException {
    MimeMessage msg = new MimeMessage(Session.getInstance(new Properties()));
    msg.setFrom("me@test.local");
    msg.setRecipients(jakarta.mail.Message.RecipientType.TO, "you@test.local");
    msg.setSubject("크기");
    msg.setText("x".repeat(bodyBytes));
    return msg;
  }

  /** 인사·EHLO(지정한 확장 한 줄)·QUIT 만 답하는 가짜 SMTP 서버 — SIZE 광고를 재현한다(GreenMail 은 SIZE 를 정할 수 없다). */
  private static final class FakeEhloServer implements AutoCloseable {
    private final ServerSocket socket = new ServerSocket(0);
    private final Thread thread;

    FakeEhloServer(String extensionLine) throws Exception {
      thread =
          new Thread(
              () -> {
                try (Socket c = socket.accept()) {
                  BufferedReader in =
                      new BufferedReader(
                          new InputStreamReader(c.getInputStream(), StandardCharsets.US_ASCII));
                  OutputStream out = c.getOutputStream();
                  send(out, "220 fake ESMTP");
                  String line;
                  while ((line = in.readLine()) != null) {
                    String cmd = line.toUpperCase();
                    if (cmd.startsWith("EHLO")) {
                      send(out, "250-fake\r\n" + extensionLine + "\r\n250 HELP");
                    } else if (cmd.startsWith("QUIT")) {
                      send(out, "221 bye");
                      return;
                    } else {
                      send(out, "250 OK");
                    }
                  }
                } catch (Exception ignored) {
                  // 테스트 종료로 소켓이 닫힘
                }
              });
      thread.setDaemon(true);
      thread.start();
    }

    private static void send(OutputStream out, String reply) throws Exception {
      out.write((reply + "\r\n").getBytes(StandardCharsets.US_ASCII));
      out.flush();
    }

    Transport connect() throws MessagingException {
      Properties props = new Properties();
      props.put("mail.smtp.timeout", "5000");
      props.put("mail.smtp.connectiontimeout", "5000");
      Transport t = Session.getInstance(props).getTransport("smtp");
      t.connect("127.0.0.1", socket.getLocalPort(), null, null);
      return t;
    }

    @Override
    public void close() throws Exception {
      socket.close();
      thread.join(2000);
    }
  }
}
