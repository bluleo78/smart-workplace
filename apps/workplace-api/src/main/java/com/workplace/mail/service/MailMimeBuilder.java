package com.workplace.mail.service;

import com.workplace.mail.dto.EmailAccountResponse;
import com.workplace.mail.dto.OutgoingMail;
import com.workplace.mail.dto.OutgoingMail.InlineImagePart;
import jakarta.activation.DataHandler;
import jakarta.mail.Message;
import jakarta.mail.MessagingException;
import jakarta.mail.Part;
import jakarta.mail.Session;
import jakarta.mail.internet.InternetAddress;
import jakarta.mail.internet.MimeBodyPart;
import jakarta.mail.internet.MimeMessage;
import jakarta.mail.internet.MimeMultipart;
import jakarta.mail.internet.MimeUtility;
import jakarta.mail.util.ByteArrayDataSource;
import java.io.UnsupportedEncodingException;
import java.util.Date;
import java.util.List;
import java.util.Properties;
import org.springframework.stereotype.Component;

/**
 * OutgoingMail 을 MIME 메시지로 조립하는 공유 빌더. SMTP 전송과 Graph base64 발송이 동일한 MIME(특히 In-Reply-To/References
 * 스레딩 헤더와 직접 지정한 Message-ID)을 공유하도록 단일 출처로 둔다. 전송 계층과 무관하므로 인증 없는 기본 Session 으로 조립한다.
 */
@Component
public class MailMimeBuilder {

  /** OutgoingMail → MimeMessage. updateMessageID 오버라이드로 직접 지정한 Message-ID 를 보존. */
  public MimeMessage build(EmailAccountResponse account, OutgoingMail mail)
      throws MessagingException {
    Session session = Session.getInstance(new Properties());
    MimeMessage msg =
        new MimeMessage(session) {
          @Override
          protected void updateMessageID() throws MessagingException {
            if (getHeader("Message-ID") == null) {
              super.updateMessageID();
            }
          }
        };
    msg.setHeader("Message-ID", "<" + mail.messageId() + ">");
    msg.setFrom(fromAddress(account));
    msg.setRecipients(Message.RecipientType.TO, parse(mail.to()));
    if (mail.cc() != null && !mail.cc().isEmpty()) {
      msg.setRecipients(Message.RecipientType.CC, parse(mail.cc()));
    }
    // Bcc 는 헤더 미설정 — 봉투(envelope)로만 전달(SMTP). Graph 는 MIME 의 To/Cc 만 사용.
    msg.setSubject(mail.subject() == null ? "" : mail.subject(), "UTF-8");
    msg.setSentDate(Date.from(mail.sentAt()));
    if (mail.inReplyTo() != null) {
      msg.setHeader("In-Reply-To", "<" + mail.inReplyTo() + ">");
    }
    if (mail.references() != null) {
      msg.setHeader("References", mail.references());
    }

    MimeBodyPart textPart = new MimeBodyPart();
    textPart.setText(mail.bodyText() == null ? "" : mail.bodyText(), "UTF-8");
    MimeBodyPart htmlPart = new MimeBodyPart();
    htmlPart.setContent(mail.bodyHtml() == null ? "" : mail.bodyHtml(), "text/html; charset=UTF-8");
    MimeMultipart alt = new MimeMultipart("alternative");
    alt.addBodyPart(textPart);
    alt.addBodyPart(htmlPart);
    List<InlineImagePart> images = mail.inlineImages();
    if (images.isEmpty()) {
      msg.setContent(alt);
    } else {
      // WP-69: 인용문 인라인 이미지 — multipart/related(alternative + 이미지들). 본문 cid: 가 Content-ID 로 파트를 찾는다.
      MimeMultipart related = new MimeMultipart("related");
      MimeBodyPart altWrapper = new MimeBodyPart();
      altWrapper.setContent(alt);
      related.addBodyPart(altWrapper);
      for (InlineImagePart img : images) {
        related.addBodyPart(inlinePart(img));
      }
      msg.setContent(related);
    }
    msg.saveChanges();
    return msg;
  }

  /** 인라인 이미지 파트 — Content-ID(꺾쇠 포함 헤더 표기) + inline disposition + base64 전송 인코딩. */
  private MimeBodyPart inlinePart(InlineImagePart img) throws MessagingException {
    MimeBodyPart part = new MimeBodyPart();
    part.setDataHandler(new DataHandler(new ByteArrayDataSource(img.content(), img.contentType())));
    part.setContentID("<" + img.contentId() + ">");
    part.setDisposition(Part.INLINE);
    if (img.filename() != null && !img.filename().isBlank()) {
      try {
        part.setFileName(MimeUtility.encodeText(img.filename(), "UTF-8", null));
      } catch (UnsupportedEncodingException e) {
        throw new MessagingException("인라인 파일명 인코딩 실패", e);
      }
    }
    part.setHeader("Content-Transfer-Encoding", "base64");
    return part;
  }

  /** 발신자 InternetAddress 를 구성한다. displayName 은 UTF-8 인코딩. */
  private InternetAddress fromAddress(EmailAccountResponse account) throws MessagingException {
    try {
      return new InternetAddress(account.emailAddress(), account.displayName(), "UTF-8");
    } catch (UnsupportedEncodingException e) {
      throw new MessagingException("발신 주소 구성 실패", e);
    }
  }

  /** 주소 문자열 목록 → InternetAddress 배열. */
  private InternetAddress[] parse(List<String> addrs) throws MessagingException {
    InternetAddress[] out = new InternetAddress[addrs.size()];
    for (int i = 0; i < addrs.size(); i++) {
      out[i] = new InternetAddress(addrs.get(i));
    }
    return out;
  }
}
