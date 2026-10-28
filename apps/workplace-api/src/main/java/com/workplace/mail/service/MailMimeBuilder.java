package com.workplace.mail.service;

import com.workplace.mail.dto.EmailAccountResponse;
import com.workplace.mail.dto.OutgoingMail;
import com.workplace.mail.dto.OutgoingMail.AttachmentPart;
import com.workplace.mail.dto.OutgoingMail.InlineImagePart;
import jakarta.activation.DataHandler;
import jakarta.mail.Message;
import jakarta.mail.MessagingException;
import jakarta.mail.Part;
import jakarta.mail.Session;
import jakarta.mail.internet.ContentDisposition;
import jakarta.mail.internet.ContentType;
import jakarta.mail.internet.InternetAddress;
import jakarta.mail.internet.MimeBodyPart;
import jakarta.mail.internet.MimeMessage;
import jakarta.mail.internet.MimeMultipart;
import jakarta.mail.internet.MimeUtility;
import jakarta.mail.internet.ParameterList;
import jakarta.mail.util.ByteArrayDataSource;
import java.io.UnsupportedEncodingException;
import java.util.Date;
import java.util.List;
import java.util.Properties;
import org.springframework.stereotype.Component;

/**
 * OutgoingMail 을 MIME 메시지로 조립하는 공유 빌더. SMTP 전송과 Graph base64 발송이 동일한 MIME(특히 In-Reply-To/References
 * 스레딩 헤더와 직접 지정한 Message-ID)을 공유하도록 단일 출처로 둔다. 전송 계층과 무관하므로 인증 없는 기본 Session 으로 조립한다.
 *
 * <p>구조: 본문은 multipart/alternative(text+html), 인용문 인라인 이미지가 있으면 multipart/related 로 감싸고(WP-69), 일반
 * 첨부가 있으면 그 바깥을 다시 multipart/mixed 로 감싼다(WP-574) — mixed[ related[ alternative, 이미지… ] |
 * alternative, 첨부… ].
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
    MimeMultipart body = alt;
    List<InlineImagePart> images = mail.inlineImages();
    if (!images.isEmpty()) {
      // WP-69: 인용문 인라인 이미지 — multipart/related(alternative + 이미지들). 본문 cid: 가 Content-ID 로 파트를 찾는다.
      MimeMultipart related = new MimeMultipart("related");
      related.addBodyPart(wrap(alt));
      for (InlineImagePart img : images) {
        related.addBodyPart(inlinePart(img));
      }
      body = related;
    }
    List<AttachmentPart> attachments = mail.attachments();
    if (!attachments.isEmpty()) {
      // WP-574: 일반 첨부 — multipart/mixed(본문 + 첨부들). 본문 구조(alternative/related)는 첫 파트로 그대로 둔다.
      MimeMultipart mixed = new MimeMultipart("mixed");
      mixed.addBodyPart(wrap(body));
      for (AttachmentPart att : attachments) {
        mixed.addBodyPart(attachmentPart(att));
      }
      body = mixed;
    }
    msg.setContent(body);
    msg.saveChanges();
    return msg;
  }

  /**
   * WP-986: 일정 초대 응답(iCalendar METHOD:REPLY) 메일 조립. 받는 쪽(Outlook·Gmail 등)이 응답으로 처리하도록
   * multipart/alternative 안에 사람이 읽는 text/plain 과 {@code text/calendar; method=REPLY; charset=UTF-8}
   * 파트를 둔다 — 캘린더 파트를 첨부가 아닌 본문 대안으로 두는 것이 RFC 6047(iMIP)의 권장 형태다. 스레딩·Message-ID 등 헤더 규칙은 {@link
   * #build} 와 같다(html 파트는 없다).
   *
   * @param ics METHOD:REPLY VCALENDAR 원문(CRLF 줄 끝)
   */
  public MimeMessage buildCalendarReply(EmailAccountResponse account, OutgoingMail mail, String ics)
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
    MimeBodyPart calPart = new MimeBodyPart();
    calPart.setContent(ics, "text/calendar; method=REPLY; charset=UTF-8");
    // 전송 인코딩은 Jakarta Mail 이 고른다(한글 SUMMARY 면 quoted-printable/base64) — 8bit 는 8BITMIME 없는 서버에서 깨질
    // 수 있다
    MimeMultipart alt = new MimeMultipart("alternative");
    alt.addBodyPart(textPart);
    alt.addBodyPart(calPart);
    msg.setContent(alt);
    msg.saveChanges();
    return msg;
  }

  /** 하위 multipart 를 상위 multipart 의 한 파트로 감싼다. */
  private static MimeBodyPart wrap(MimeMultipart inner) throws MessagingException {
    MimeBodyPart part = new MimeBodyPart();
    part.setContent(inner);
    return part;
  }

  /**
   * 일반 첨부 파트(WP-574) — Content-Type 은 파일 것을 쓰되 해석할 수 없으면 application/octet-stream. 파일명은 수신 클라이언트
   * 호환을 위해 두 곳에 다르게 인코딩한다: Content-Disposition filename 은 RFC 2231(filename*=UTF-8''…),
   * Content-Type name 은 RFC 2047 encoded-word(구형 Outlook 등이 이쪽만 읽는다). 전송 인코딩은 base64 로 고정해 text/*
   * 파일도 줄바꿈 정규화 없이 바이트가 그대로 전달되게 한다.
   */
  private MimeBodyPart attachmentPart(AttachmentPart att) throws MessagingException {
    String filename = att.filenameOrDefault();
    // 구체 타입(type/subtype)만 남긴다 — 비었거나 깨진 값(헤더 인젝션 포함)은 octet-stream(공용 규칙, MimeNormalizer).
    String[] type = att.concreteContentType().split("/", 2);
    ContentType ct = new ContentType(type[0], type[1], null);
    ParameterList cdParams = new ParameterList();
    if (isAscii(filename)) {
      ct.setParameter("name", filename);
      cdParams.set("filename", filename);
    } else {
      try {
        ct.setParameter("name", MimeUtility.encodeText(filename, "UTF-8", "B"));
      } catch (UnsupportedEncodingException e) {
        throw new MessagingException("첨부 파일명 인코딩 실패", e);
      }
      // charset 을 주면 ParameterList 가 RFC 2231 로 인코딩한다(filename*=UTF-8''%ED%95%9C…).
      cdParams.set("filename", filename, "UTF-8");
    }
    ContentDisposition cd = new ContentDisposition(Part.ATTACHMENT, cdParams);
    MimeBodyPart part = new MimeBodyPart();
    part.setDataHandler(new DataHandler(new ByteArrayDataSource(att.content(), ct.getBaseType())));
    // setDataHandler 가 Content-Type 헤더를 지우므로 그 뒤에 name 파라미터를 포함한 헤더를 단다(saveChanges 는 있는 헤더를 유지).
    part.setHeader("Content-Type", ct.toString());
    part.setHeader("Content-Disposition", cd.toString());
    part.setHeader("Content-Transfer-Encoding", "base64");
    return part;
  }

  /** 7비트 ASCII 출력 가능 문자만으로 된 이름인지 — 아니면 파일명 인코딩이 필요하다. */
  private static boolean isAscii(String s) {
    return s.chars().allMatch(c -> c >= 0x20 && c < 0x7F);
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
