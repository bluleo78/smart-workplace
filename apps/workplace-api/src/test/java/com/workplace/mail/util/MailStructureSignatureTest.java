package com.workplace.mail.util;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import jakarta.mail.MessagingException;
import jakarta.mail.Part;
import jakarta.mail.Session;
import jakarta.mail.internet.MimeBodyPart;
import jakarta.mail.internet.MimeMessage;
import jakarta.mail.internet.MimeMultipart;
import java.util.Properties;
import org.junit.jupiter.api.Test;

/** MailStructureSignature 단위 테스트 — 결정성, 첨부 구성 변화 감지, 파싱 실패 시 null(fail-closed). */
class MailStructureSignatureTest {

  /** 본문 + 첨부 1개 메시지. 첨부 바이트로 크기를 바꿀 수 있다. */
  private static MimeMessage message(String attachmentName, String attachmentBytes)
      throws Exception {
    MimeMessage msg = new MimeMessage(Session.getInstance(new Properties()));
    MimeBodyPart text = new MimeBodyPart();
    text.setText("본문");
    MimeBodyPart att = new MimeBodyPart();
    att.setContent(attachmentBytes.getBytes(), "application/pdf");
    att.setFileName(attachmentName);
    att.setDisposition(Part.ATTACHMENT);
    MimeMultipart mp = new MimeMultipart("mixed");
    mp.addBodyPart(text);
    mp.addBodyPart(att);
    msg.setContent(mp);
    msg.saveChanges();
    // 직렬화 후 재파싱 — 수신 메일처럼 파트 크기(getSize)가 채워진 상태로 만든다
    var out = new java.io.ByteArrayOutputStream();
    msg.writeTo(out);
    return new MimeMessage(
        Session.getInstance(new Properties()), new java.io.ByteArrayInputStream(out.toByteArray()));
  }

  @Test
  void sameStructure_sameSignature() throws Exception {
    String s1 = MailStructureSignature.of(message("a.pdf", "0123456789"));
    String s2 = MailStructureSignature.of(message("a.pdf", "0123456789"));
    assertThat(s1).isNotNull().isEqualTo(s2).startsWith("[multipart/mixed[text/plain");
    assertThat(s1).contains("a.pdf");
  }

  @Test
  void differentAttachment_changesSignature() throws Exception {
    String base = MailStructureSignature.of(message("a.pdf", "0123456789"));
    assertThat(MailStructureSignature.of(message("b.pdf", "0123456789"))).isNotEqualTo(base);
    assertThat(MailStructureSignature.of(message("a.pdf", "0123456789-longer"))).isNotEqualTo(base);
  }

  @Test
  void brokenPart_returnsNull() throws Exception {
    Part broken = mock(Part.class);
    when(broken.getContentType()).thenThrow(new MessagingException("BODYSTRUCTURE 파싱 실패"));
    assertThat(MailStructureSignature.of(broken)).isNull();
  }
}
