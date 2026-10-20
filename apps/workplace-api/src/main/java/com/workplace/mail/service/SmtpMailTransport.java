package com.workplace.mail.service;

import com.workplace.mail.dto.EmailAccountResponse;
import com.workplace.mail.dto.MailProvider;
import com.workplace.mail.dto.MailSecurity;
import com.workplace.mail.dto.OutgoingMail;
import com.workplace.mail.exception.MailSendException;
import com.workplace.mail.exception.MailValidationException;
import jakarta.mail.Address;
import jakarta.mail.MessagingException;
import jakarta.mail.Session;
import jakarta.mail.Transport;
import jakarta.mail.internet.InternetAddress;
import jakarta.mail.internet.MimeMessage;
import java.util.ArrayList;
import java.util.Collections;
import java.util.IdentityHashMap;
import java.util.List;
import java.util.Properties;
import java.util.Set;
import java.util.regex.Pattern;
import lombok.RequiredArgsConstructor;
import org.eclipse.angus.mail.smtp.SMTPAddressFailedException;
import org.eclipse.angus.mail.smtp.SMTPSendFailedException;
import org.eclipse.angus.mail.smtp.SMTPSenderFailedException;
import org.springframework.stereotype.Component;

/**
 * IMAP/SMTP 계정 전송기. 비밀번호를 직접 조회·복호화하고 SMTP 로 발송한다(봉투 수신자=To+Cc+Bcc). IMAP APPEND(Sent 보관)는 호출 측
 * MailComposeService → MailSentAppender 가 수행한다.
 */
@Component
@RequiredArgsConstructor
public class SmtpMailTransport implements MailTransport {

  /** 받는 서버가 메일 크기로 거절했을 때 사용자 문구(WP-574). */
  static final String SIZE_REJECTED_MESSAGE = "받는 메일 서버가 허용하는 크기를 넘었어요. 첨부를 줄이거나 나눠서 보내 주세요";

  /** 연결·읽기 타임아웃(ms) — 행 방지. */
  private static final int TIMEOUT_MS = 10_000;

  /**
   * 첨부가 있는 메일의 읽기·쓰기 타임아웃(ms, WP-574). 25MB 첨부는 base64 로 약 34MB 를 DATA 로 쓰고, 서버는 본문을 다 받은 뒤 크기·바이러스
   * 검사를 마치고서야 최종 250 을 돌려준다. 10초로는 그 응답을 기다리다 끊겨 이미 나간 메일을 실패로 처리할 수 있어(사용자는 다시 보낸다) 2분으로 늘린다. 연결
   * 타임아웃은 그대로 10초.
   */
  static final int ATTACHMENT_IO_TIMEOUT_MS = 120_000;

  private final MailAccountCredentials credentials;

  @Override
  public MailProvider provider() {
    return MailProvider.IMAP;
  }

  @Override
  public String transmit(
      long userId, EmailAccountResponse account, MimeMessage message, OutgoingMail mail) {
    // 자격증명 조회(RLS 읽기 트랜잭션)는 MailAccountCredentials 가 맡고, 여기서는 I/O 만 한다(WP-574).
    String password = credentials.password(userId, account.id());
    try {
      Session session = smtpSession(account, !mail.attachments().isEmpty());
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
      // WP-574: 크기 초과 거절(552 / 5.3.4)은 서버 장애가 아니라 사용자가 고칠 수 있는 오류 — 400 + 안내 문구.
      if (isSizeRejection(e)) {
        throw new MailValidationException(SIZE_REJECTED_MESSAGE);
      }
      throw new MailSendException("메일 발송에 실패했습니다", e);
    }
    // SMTP 는 MIME 에 넣은 Message-ID 그대로 나간다
    return mail.messageId();
  }

  /** 확장 상태 코드 5.2.2(RFC 3463 메일함 가득 참) — 5.2.20 같은 다른 코드와 섞이지 않게 앞뒤를 끊어 본다. */
  private static final Pattern MAILBOX_FULL = Pattern.compile("(?<![\\d.])5\\.2\\.2(?!\\d)");

  /**
   * SMTP 크기 초과 거절인지 — 응답 코드 552(RFC 5321 저장 공간 초과, 크기 제한에 쓰인다) 또는 확장 상태 코드 5.3.4(메시지가 고정 크기 한도를 넘음,
   * RFC 3463). 예외가 원인·다음 예외(getNextException)로 감싸여 오므로 사슬을 따라가며 본다.
   *
   * <p>단 확장 코드 5.2.2(받는 쪽 메일함 가득 참)가 붙은 552 는 크기 초과가 아니다 — 첨부를 줄여도 풀리지 않으므로 「크기를 넘었어요」로 안내하면 사용자를
   * 잘못 이끈다. 그 층은 건너뛰고 사슬의 다음 예외를 본다(일반 발송 실패로 끝난다).
   */
  static boolean isSizeRejection(Throwable error) {
    Set<Throwable> seen = Collections.newSetFromMap(new IdentityHashMap<>());
    Throwable t = error;
    while (t != null && seen.add(t)) {
      String msg = t.getMessage();
      boolean mailboxFull = msg != null && MAILBOX_FULL.matcher(msg).find();
      if (!mailboxFull) {
        if (returnCode(t) == 552) {
          return true;
        }
        if (msg != null && (msg.contains("5.3.4") || msg.trim().startsWith("552"))) {
          return true;
        }
      }
      Throwable next = t instanceof MessagingException me ? me.getNextException() : null;
      t = next != null ? next : t.getCause();
    }
    return false;
  }

  /** Angus SMTP 예외의 응답 코드(없으면 -1). */
  private static int returnCode(Throwable t) {
    if (t instanceof SMTPSendFailedException e) {
      return e.getReturnCode();
    }
    if (t instanceof SMTPAddressFailedException e) {
      return e.getReturnCode();
    }
    if (t instanceof SMTPSenderFailedException e) {
      return e.getReturnCode();
    }
    return -1;
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
  private Session smtpSession(EmailAccountResponse account, boolean hasAttachments) {
    MailSecurity security = account.smtpSecurity();
    Properties props = new Properties();
    props.put("mail.transport.protocol", "smtp");
    props.put("mail.smtp.auth", "true");
    props.put("mail.smtp.connectiontimeout", String.valueOf(TIMEOUT_MS));
    int ioTimeout = hasAttachments ? ATTACHMENT_IO_TIMEOUT_MS : TIMEOUT_MS;
    props.put("mail.smtp.timeout", String.valueOf(ioTimeout));
    // 쓰기 타임아웃 — 큰 DATA 를 쓰다 상대가 받지 않을 때도 끝없이 걸리지 않게(읽기와 같은 값).
    props.put("mail.smtp.writetimeout", String.valueOf(ioTimeout));
    if (security == MailSecurity.SSL_TLS) {
      props.put("mail.smtp.ssl.enable", "true");
    } else if (security == MailSecurity.STARTTLS) {
      props.put("mail.smtp.starttls.enable", "true");
      props.put("mail.smtp.starttls.required", "true");
    }
    return Session.getInstance(props);
  }
}
