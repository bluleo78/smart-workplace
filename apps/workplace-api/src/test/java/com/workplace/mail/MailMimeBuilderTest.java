package com.workplace.mail;

import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.mail.dto.EmailAccountResponse;
import com.workplace.mail.dto.MailProvider;
import com.workplace.mail.dto.MailSecurity;
import com.workplace.mail.dto.OutgoingMail;
import com.workplace.mail.service.MailMimeBuilder;
import jakarta.mail.internet.MimeMessage;
import java.io.ByteArrayOutputStream;
import java.time.Instant;
import java.util.List;
import org.junit.jupiter.api.Test;

/** MailMimeBuilder 순수 단위 — Message-ID/스레딩 헤더 보존 + 직렬화 바이트에 헤더 포함. */
class MailMimeBuilderTest {

  private final MailMimeBuilder builder = new MailMimeBuilder();

  /** 테스트용 계정 픽스처. EmailAccountResponse 실제 필드 순서(17개) 그대로 사용. */
  private EmailAccountResponse account() {
    return new EmailAccountResponse(
        1L,
        "me@iacloud.kr",
        "나",
        "imap",
        993,
        MailSecurity.SSL_TLS,
        "me@iacloud.kr",
        "smtp",
        587,
        MailSecurity.STARTTLS,
        "me@iacloud.kr",
        null, // lastTestedAt
        null, // createdAt
        null, // updatedAt
        false, // aiEnabled
        null, // lastSyncedAt
        MailProvider.M365_GRAPH);
  }

  /** 테스트용 답장 메일 픽스처. OutgoingMail 실제 필드 순서(14개) 그대로 사용. */
  private OutgoingMail reply() {
    return new OutgoingMail(
        "new-id@iacloud.kr",
        "thread-root@iacloud.kr",
        "me@iacloud.kr",
        "나",
        List.of("peer@example.com"),
        List.of(),
        List.of(),
        "RE: 안건",
        "본문",
        "<p>본문</p>",
        "parent-id@example.com",
        "<root@example.com> <parent-id@example.com>",
        "본문",
        Instant.parse("2026-06-26T00:00:00Z"));
  }

  @Test
  void build_preservesMessageIdAndThreadingHeaders() throws Exception {
    MimeMessage msg = builder.build(account(), reply());
    assertThat(msg.getHeader("Message-ID")[0]).isEqualTo("<new-id@iacloud.kr>");
    assertThat(msg.getHeader("In-Reply-To")[0]).isEqualTo("<parent-id@example.com>");
    assertThat(msg.getHeader("References")[0]).contains("parent-id@example.com");
  }

  @Test
  void build_serializesWithThreadingHeaders() throws Exception {
    MimeMessage msg = builder.build(account(), reply());
    ByteArrayOutputStream out = new ByteArrayOutputStream();
    msg.writeTo(out);
    String raw = out.toString();
    assertThat(raw).contains("In-Reply-To:").contains("parent-id@example.com");
    assertThat(raw).contains("References:");
  }
}
