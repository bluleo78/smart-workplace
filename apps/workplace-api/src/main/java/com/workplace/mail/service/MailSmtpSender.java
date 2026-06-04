package com.workplace.mail.service;

import com.workplace.mail.dto.EmailAccountResponse;
import com.workplace.mail.dto.MailSecurity;
import com.workplace.mail.dto.OutgoingMail;
import jakarta.mail.Address;
import jakarta.mail.Message;
import jakarta.mail.MessagingException;
import jakarta.mail.Session;
import jakarta.mail.Transport;
import jakarta.mail.internet.InternetAddress;
import jakarta.mail.internet.MimeBodyPart;
import jakarta.mail.internet.MimeMessage;
import jakarta.mail.internet.MimeMultipart;
import java.io.UnsupportedEncodingException;
import java.util.ArrayList;
import java.util.Date;
import java.util.List;
import java.util.Properties;
import org.springframework.stereotype.Component;

/**
 * OutgoingMail 을 MIME 메시지로 빌드해 SMTP 로 발송한다. Message-ID 는 호출 측이 정한 값을 보존하고(전송본·APPEND·로컬 행이 같은 ID
 * 공유), 본문은 multipart/alternative(text+html)로 구성한다. Bcc 는 헤더에 넣지 않고 봉투(sendMessage 수신자)로만 전달한다. 외부
 * 의존이 없어 단위 테스트에서 new 로 생성 가능.
 */
@Component
public class MailSmtpSender {

  /** 연결·읽기 타임아웃(ms) — 행 방지. */
  private static final int TIMEOUT_MS = 10_000;

  /** 메일을 전송하고 전송된 MimeMessage 를 반환(APPEND 재사용). */
  public MimeMessage send(EmailAccountResponse account, String password, OutgoingMail mail)
      throws MessagingException {
    Session session = smtpSession(account);
    MimeMessage msg = build(session, account, mail);

    Address[] envelope = envelope(mail);
    Transport transport = session.getTransport("smtp");
    try {
      transport.connect(account.smtpHost(), account.smtpPort(), account.smtpUsername(), password);
      transport.sendMessage(msg, envelope);
    } finally {
      try {
        transport.close();
      } catch (MessagingException ignored) {
        // 발송 성공 여부에 영향 없음
      }
    }
    return msg;
  }

  /** OutgoingMail → MimeMessage. updateMessageID 오버라이드로 직접 지정한 Message-ID 를 보존. */
  private MimeMessage build(Session session, EmailAccountResponse account, OutgoingMail mail)
      throws MessagingException {
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
    // Bcc 는 헤더 미설정 — 봉투(envelope)로만 전달.
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
    msg.setContent(alt);
    msg.saveChanges();
    return msg;
  }

  private InternetAddress fromAddress(EmailAccountResponse account) throws MessagingException {
    try {
      return new InternetAddress(account.emailAddress(), account.displayName(), "UTF-8");
    } catch (UnsupportedEncodingException e) {
      throw new MessagingException("발신 주소 구성 실패", e);
    }
  }

  /** To+Cc+Bcc 전체를 봉투 수신자로 합친다(실제 전달 대상). */
  private Address[] envelope(OutgoingMail mail) throws MessagingException {
    List<Address> all = new ArrayList<>();
    addAll(all, mail.to());
    addAll(all, mail.cc());
    addAll(all, mail.bcc());
    return all.toArray(new Address[0]);
  }

  private void addAll(List<Address> acc, List<String> addrs) throws MessagingException {
    if (addrs == null) {
      return;
    }
    for (String a : addrs) {
      acc.add(new InternetAddress(a));
    }
  }

  private InternetAddress[] parse(List<String> addrs) throws MessagingException {
    InternetAddress[] out = new InternetAddress[addrs.size()];
    for (int i = 0; i < addrs.size(); i++) {
      out[i] = new InternetAddress(addrs.get(i));
    }
    return out;
  }

  /** SMTP 세션(MailConnectionTester 와 동일 보안/타임아웃 정책). */
  private Session smtpSession(EmailAccountResponse account) {
    MailSecurity security = account.smtpSecurity();
    Properties props = new Properties();
    props.put("mail.transport.protocol", "smtp");
    props.put("mail.smtp.auth", "true");
    props.put("mail.smtp.connectiontimeout", String.valueOf(TIMEOUT_MS));
    props.put("mail.smtp.timeout", String.valueOf(TIMEOUT_MS));
    if (security == MailSecurity.SSL_TLS) {
      props.put("mail.smtp.ssl.enable", "true");
    } else if (security == MailSecurity.STARTTLS) {
      props.put("mail.smtp.starttls.enable", "true");
      props.put("mail.smtp.starttls.required", "true");
    }
    return Session.getInstance(props);
  }
}
