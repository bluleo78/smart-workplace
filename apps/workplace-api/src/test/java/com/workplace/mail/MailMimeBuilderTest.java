package com.workplace.mail;

import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.mail.dto.EmailAccountResponse;
import com.workplace.mail.dto.MailProvider;
import com.workplace.mail.dto.MailSecurity;
import com.workplace.mail.dto.OutgoingMail;
import com.workplace.mail.dto.OutgoingMail.AttachmentPart;
import com.workplace.mail.dto.OutgoingMail.InlineImagePart;
import com.workplace.mail.dto.ParsedAttachment;
import com.workplace.mail.dto.ParsedBody;
import com.workplace.mail.service.MailMessageParser;
import com.workplace.mail.service.MailMimeBuilder;
import jakarta.mail.BodyPart;
import jakarta.mail.Part;
import jakarta.mail.Session;
import jakarta.mail.internet.MimeMessage;
import jakarta.mail.internet.MimeMultipart;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.List;
import java.util.Properties;
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
        Instant.parse("2026-06-26T00:00:00Z"),
        List.of(),
        List.of());
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

  // ---- WP-574: 일반 첨부 multipart/mixed ----

  /** CRLF·LF 가 섞인 텍스트 — base64 고정이 아니면 줄바꿈 정규화로 바이트가 바뀐다. */
  private static final byte[] TEXT_BYTES = "줄1\r\n줄2\n끝".getBytes(StandardCharsets.UTF_8);

  private static final byte[] BIN_BYTES = {0, 1, 2, (byte) 0xFF, (byte) 0xFE, 10, 13};

  private OutgoingMail withAttachments(
      List<InlineImagePart> inline, List<AttachmentPart> attachments) {
    OutgoingMail r = reply();
    return new OutgoingMail(
        r.messageId(),
        r.threadId(),
        r.fromAddress(),
        r.fromName(),
        r.to(),
        r.cc(),
        r.bcc(),
        r.subject(),
        r.bodyText(),
        r.bodyHtml(),
        r.inReplyTo(),
        r.references(),
        r.snippet(),
        r.sentAt(),
        inline,
        attachments);
  }

  /** 직렬화 후 다시 읽는다 — 수신 측이 보는 그대로 검증한다. */
  private static MimeMessage roundTrip(MimeMessage msg) throws Exception {
    ByteArrayOutputStream out = new ByteArrayOutputStream();
    msg.writeTo(out);
    return new MimeMessage(
        Session.getInstance(new Properties()), new ByteArrayInputStream(out.toByteArray()));
  }

  private static String raw(MimeMessage msg) throws Exception {
    ByteArrayOutputStream out = new ByteArrayOutputStream();
    msg.writeTo(out);
    return out.toString(StandardCharsets.US_ASCII);
  }

  @Test
  void build_withAttachments_wrapsAlternativeInMixed_andKeepsBytes() throws Exception {
    OutgoingMail mail =
        withAttachments(
            List.of(),
            List.of(
                new AttachmentPart("보고서 최종.txt", "text/plain", TEXT_BYTES),
                new AttachmentPart("data.bin", null, BIN_BYTES)));

    MimeMessage parsed = roundTrip(builder.build(account(), mail));

    assertThat(parsed.isMimeType("multipart/mixed")).isTrue();
    MimeMultipart mixed = (MimeMultipart) parsed.getContent();
    assertThat(mixed.getCount()).isEqualTo(3);
    // 첫 파트는 기존 본문 구조(alternative) 그대로
    assertThat(mixed.getBodyPart(0).isMimeType("multipart/alternative")).isTrue();

    BodyPart txt = mixed.getBodyPart(1);
    assertThat(txt.getDisposition()).isEqualToIgnoringCase(Part.ATTACHMENT);
    assertThat(txt.getFileName()).isEqualTo("보고서 최종.txt");
    assertThat(txt.isMimeType("text/plain")).isTrue();
    assertThat(txt.getInputStream().readAllBytes()).isEqualTo(TEXT_BYTES);

    BodyPart bin = mixed.getBodyPart(2);
    // 타입을 모르면 application/octet-stream
    assertThat(bin.isMimeType("application/octet-stream")).isTrue();
    assertThat(bin.getFileName()).isEqualTo("data.bin");
    assertThat(bin.getInputStream().readAllBytes()).isEqualTo(BIN_BYTES);
  }

  /** 한글 파일명 — Content-Disposition 은 RFC 2231, Content-Type name 은 RFC 2047 로 실린다. */
  @Test
  void build_koreanFilename_encodesRfc2231AndRfc2047() throws Exception {
    OutgoingMail mail =
        withAttachments(
            List.of(), List.of(new AttachmentPart("한글.pdf", "application/pdf", BIN_BYTES)));

    String raw = raw(builder.build(account(), mail));

    assertThat(raw).contains("filename*=UTF-8''%ED%95%9C%EA%B8%80.pdf");
    assertThat(raw).contains("name=\"=?UTF-8?B?");
    assertThat(raw).doesNotContain("한글");
  }

  /** 인라인 이미지와 첨부가 함께면 mixed[ related[ alternative, 이미지 ], 첨부 ]. */
  @Test
  void build_withInlineAndAttachments_keepsRelatedInsideMixed() throws Exception {
    OutgoingMail mail =
        withAttachments(
            List.of(new InlineImagePart("img1", "a.png", "image/png", BIN_BYTES)),
            List.of(new AttachmentPart("b.txt", "text/plain", TEXT_BYTES)));

    MimeMessage parsed = roundTrip(builder.build(account(), mail));

    MimeMultipart mixed = (MimeMultipart) parsed.getContent();
    assertThat(mixed.getCount()).isEqualTo(2);
    assertThat(mixed.getBodyPart(0).isMimeType("multipart/related")).isTrue();
    MimeMultipart related = (MimeMultipart) mixed.getBodyPart(0).getContent();
    assertThat(related.getBodyPart(0).isMimeType("multipart/alternative")).isTrue();
    assertThat(related.getBodyPart(1).getHeader("Content-ID")[0]).isEqualTo("<img1>");
    assertThat(mixed.getBodyPart(1).getFileName()).isEqualTo("b.txt");
  }

  /** 받은 메일 파서로 다시 읽으면 첨부 메타가 그대로 나온다 — IMAP Sent APPEND 사본도 같은 MIME 이다. */
  @Test
  void build_withAttachments_reparsesAsAttachmentsByMailParser() throws Exception {
    OutgoingMail mail =
        withAttachments(
            List.of(),
            List.of(
                new AttachmentPart("한글 문서.hwp", "application/x-hwp", BIN_BYTES),
                new AttachmentPart("b.txt", "text/plain", TEXT_BYTES)));
    MimeMessage parsed = roundTrip(builder.build(account(), mail));
    MailMessageParser parser = new MailMessageParser();

    ParsedBody body = parser.parseBody(parsed);

    assertThat(body.hasAttachment()).isTrue();
    assertThat(body.attachments())
        .extracting(ParsedAttachment::filename, ParsedAttachment::contentType)
        .containsExactly(
            org.assertj.core.groups.Tuple.tuple("한글 문서.hwp", "application/x-hwp"),
            org.assertj.core.groups.Tuple.tuple("b.txt", "text/plain"));
    assertThat(body.bodyHtml()).contains("<p>본문</p>");
    assertThat(parser.extractAttachmentBytes(parsed, 0)).isEqualTo(BIN_BYTES);
    assertThat(parser.extractAttachmentBytes(parsed, 1)).isEqualTo(TEXT_BYTES);
  }

  /** 첨부가 없으면 기존 구조(alternative) 그대로 — 회귀 방지. */
  @Test
  void build_withoutAttachments_staysAlternative() throws Exception {
    MimeMessage parsed = roundTrip(builder.build(account(), reply()));
    assertThat(parsed.isMimeType("multipart/alternative")).isTrue();
  }

  /**
   * WP-986: 초대 응답 — alternative[text/plain, text/calendar; method=REPLY] + 스레딩 헤더, iCalendar 원문 보존.
   */
  @Test
  void buildCalendarReply_hasTextAndCalendarReplyParts() throws Exception {
    String ics = "BEGIN:VCALENDAR\r\nMETHOD:REPLY\r\nSUMMARY:회의\r\nEND:VCALENDAR\r\n";
    MimeMessage msg = builder.buildCalendarReply(account(), reply(), ics);
    java.io.ByteArrayOutputStream out = new java.io.ByteArrayOutputStream();
    msg.writeTo(out);
    MimeMessage parsed =
        new MimeMessage(
            jakarta.mail.Session.getInstance(new java.util.Properties()),
            new java.io.ByteArrayInputStream(out.toByteArray()));

    assertThat(parsed.getHeader("In-Reply-To")[0]).isEqualTo("<parent-id@example.com>");
    assertThat(parsed.getContentType()).startsWith("multipart/alternative");
    jakarta.mail.Multipart mp = (jakarta.mail.Multipart) parsed.getContent();
    assertThat(mp.getCount()).isEqualTo(2);
    assertThat(mp.getBodyPart(0).isMimeType("text/plain")).isTrue();
    jakarta.mail.BodyPart cal = mp.getBodyPart(1);
    assertThat(cal.getContentType()).contains("text/calendar").contains("method=REPLY");
    try (java.io.InputStream is = cal.getInputStream()) {
      assertThat(new String(is.readAllBytes(), java.nio.charset.StandardCharsets.UTF_8))
          .isEqualTo(ics);
    }
  }
}
