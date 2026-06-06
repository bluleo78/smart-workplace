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

  // text/plain 파트가 없는 HTML 전용 메일. <style>/<script>/<head>/주석 내용이 스니펫에 노출되면 안 된다.
  private static String htmlOnlyRaw() throws Exception {
    String htmlBody =
        "<html><head><title>제목태그</title>"
            + "<style type=\"text/css\">table { border-collapse: collapse; mso-table-lspace: 0pt; }"
            + " #outlook a { padding:0; } body { margin:0; }</style></head>"
            + "<body><!-- 주석 안의 숨은텍스트 --><script>var x = 1; alert('hi');</script>"
            + "<p>실제&nbsp;본문 미리보기&amp;텍스트입니다</p></body></html>";
    return "Message-ID: <h1@example.com>\r\n"
        + "From: Mailer <mailer@example.com>\r\n"
        + "To: box@test.local\r\n"
        + "Subject: "
        + MimeUtility.encodeText("HTML 전용 메일", "UTF-8", "B")
        + "\r\n"
        + "Content-Type: text/html; charset=UTF-8\r\n\r\n"
        + htmlBody;
  }

  // 회귀: HTML 전용 메일 스니펫에서 CSS/JS/주석/head 내용이 제거되고 본문 텍스트만 남아야 한다.
  @Test
  void parseBody_htmlOnly_snippetExcludesStyleAndScript() throws Exception {
    ParsedBody b = parser.parseBody(mime(htmlOnlyRaw()));

    // <style> CSS 내용 노출 금지
    assertThat(b.snippet()).doesNotContain("border-collapse");
    assertThat(b.snippet()).doesNotContain("mso-table-lspace");
    assertThat(b.snippet()).doesNotContain("#outlook");
    // <script> JS 내용 노출 금지
    assertThat(b.snippet()).doesNotContain("alert");
    assertThat(b.snippet()).doesNotContain("var x");
    // HTML 주석 내용 노출 금지
    assertThat(b.snippet()).doesNotContain("숨은텍스트");
    // <head> 내 title 내용 노출 금지
    assertThat(b.snippet()).doesNotContain("제목태그");
    // HTML 엔티티는 디코드되어 raw 형태(&nbsp;/&amp;)가 남지 않아야 한다
    assertThat(b.snippet()).doesNotContain("&nbsp;");
    assertThat(b.snippet()).doesNotContain("&amp;");
    assertThat(b.snippet()).contains("실제 본문 미리보기&텍스트입니다");
  }
}
