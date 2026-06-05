package com.workplace.mail;

import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.mail.dto.ParsedBody;
import com.workplace.mail.dto.ParsedMessage;
import com.workplace.mail.service.MailMessageParser;
import jakarta.mail.Message;
import jakarta.mail.Session;
import jakarta.mail.internet.MimeMessage;
import jakarta.mail.internet.MimeUtility;
import java.io.ByteArrayInputStream;
import java.nio.charset.StandardCharsets;
import java.util.Properties;
import org.junit.jupiter.api.Test;

class MailMessageParserTest {

  private final MailMessageParser parser = new MailMessageParser();

  private Message mime(String raw) throws Exception {
    Session s = Session.getInstance(new Properties());
    return new MimeMessage(s, new ByteArrayInputStream(raw.getBytes(StandardCharsets.UTF_8)));
  }

  // 비ASCII Subject 는 RFC 2047 인코디드워드여야 getSubject() 가 올바로 복원한다(실제 메일 클라이언트 동작).
  // 본문은 Content-Type charset 으로 디코딩되므로 raw UTF-8 로 둔다.
  private static String raw() throws Exception {
    return "Message-ID: <m1@example.com>\r\n"
        + "From: Alice <alice@example.com>\r\n"
        + "To: box@test.local\r\n"
        + "Subject: "
        + MimeUtility.encodeText("안녕하세요", "UTF-8", "B")
        + "\r\n"
        + "Content-Type: text/plain; charset=UTF-8\r\n\r\n"
        + "본문 내용입니다";
  }

  @Test
  void parseMetadata_skipsBody() throws Exception {
    ParsedMessage m = parser.parseMetadata(42L, mime(raw()));
    assertThat(m.imapUid()).isEqualTo(42L);
    assertThat(m.messageId()).isEqualTo("m1@example.com");
    assertThat(m.subject()).isEqualTo("안녕하세요");
    assertThat(m.fromAddress()).isEqualTo("alice@example.com");
    assertThat(m.bodyText()).isNull();
    assertThat(m.bodyHtml()).isNull();
    assertThat(m.snippet()).isNull();
    assertThat(m.hasAttachment()).isFalse();
    assertThat(m.attachments()).isEmpty();
  }

  @Test
  void parseBody_extractsText() throws Exception {
    ParsedBody b = parser.parseBody(mime(raw()));
    assertThat(b.bodyText()).contains("본문 내용입니다");
    assertThat(b.snippet()).contains("본문 내용입니다");
    assertThat(b.hasAttachment()).isFalse();
  }
}
