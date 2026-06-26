package com.workplace.mail.service;

import com.workplace.global.security.EncryptionService;
import com.workplace.mail.dto.EmailAccountResponse;
import com.workplace.mail.dto.MailProvider;
import com.workplace.mail.dto.MailSecurity;
import com.workplace.mail.dto.OutgoingMail;
import com.workplace.mail.exception.EmailAccountNotFoundException;
import com.workplace.mail.exception.MailSendException;
import com.workplace.mail.repository.EmailAccountRepository;
import jakarta.mail.Address;
import jakarta.mail.MessagingException;
import jakarta.mail.Session;
import jakarta.mail.Transport;
import jakarta.mail.internet.InternetAddress;
import jakarta.mail.internet.MimeMessage;
import java.util.ArrayList;
import java.util.List;
import java.util.Properties;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;

/**
 * IMAP/SMTP 계정 전송기. 비밀번호를 직접 조회·복호화하고 SMTP 로 발송한다(봉투 수신자=To+Cc+Bcc). IMAP APPEND(Sent 보관)는 호출 측
 * MailComposeService → MailSentAppender 가 수행한다.
 */
@Component
@RequiredArgsConstructor
public class SmtpMailTransport implements MailTransport {

  /** 연결·읽기 타임아웃(ms) — 행 방지. */
  private static final int TIMEOUT_MS = 10_000;

  private final EmailAccountRepository accountRepo;
  private final EncryptionService encryption;

  @Override
  public MailProvider provider() {
    return MailProvider.IMAP;
  }

  @Override
  public void transmit(
      long userId, EmailAccountResponse account, MimeMessage message, OutgoingMail mail) {
    // 암호화된 비밀번호 조회 후 복호화 — SmtpMailTransport 가 자격증명을 직접 관리
    String password =
        accountRepo
            .findEncryptedPassword(userId, account.id())
            .map(encryption::decrypt)
            .orElseThrow(() -> new EmailAccountNotFoundException(account.id()));
    try {
      Session session = smtpSession(account);
      Address[] envelope = envelope(mail);
      Transport transport = session.getTransport("smtp");
      try {
        transport.connect(account.smtpHost(), account.smtpPort(), account.smtpUsername(), password);
        transport.sendMessage(message, envelope);
      } finally {
        try {
          transport.close();
        } catch (MessagingException ignored) {
          // 발송 성공 여부에 영향 없음
        }
      }
    } catch (MessagingException e) {
      throw new MailSendException("메일 발송에 실패했습니다", e);
    }
  }

  /** To+Cc+Bcc 전체를 SMTP 봉투 수신자로 합친다. */
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
