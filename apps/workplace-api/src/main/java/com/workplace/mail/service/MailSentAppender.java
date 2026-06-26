package com.workplace.mail.service;

import com.workplace.global.security.EncryptionService;
import com.workplace.mail.dto.EmailAccountResponse;
import com.workplace.mail.dto.MailSecurity;
import com.workplace.mail.exception.EmailAccountNotFoundException;
import com.workplace.mail.repository.EmailAccountRepository;
import jakarta.mail.Folder;
import jakarta.mail.Message;
import jakarta.mail.MessagingException;
import jakarta.mail.Session;
import jakarta.mail.Store;
import jakarta.mail.internet.MimeMessage;
import java.util.Properties;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;

/**
 * 발송한 메시지를 서버 IMAP Sent 폴더에 추가(best-effort). 표시 원본은 로컬 SENT 행이므로 APPEND 실패/폴더 부재는 로그만 남기고 무시한다(발송
 * 자체는 이미 성공). 폴더는 일반적인 Sent 후보명으로 탐색한다(OAuth/SPECIAL-USE 미지원 서버 폭넓게 수용).
 *
 * <p>비밀번호 복호화는 이 클래스 내에서 직접 수행한다(MailComposeService 에서 비번 의존 제거).
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class MailSentAppender {

  private static final int TIMEOUT_MS = 10_000;

  /** 일반적인 Sent 폴더 후보(서버마다 명칭 상이). 존재하는 첫 폴더에 APPEND. */
  private static final String[] SENT_CANDIDATES = {
    "Sent", "Sent Items", "[Gmail]/Sent Mail", "Sent Messages", "INBOX.Sent"
  };

  private final EmailAccountRepository accountRepo;
  private final EncryptionService encryption;

  /**
   * 발송본을 Sent 폴더에 추가. 비밀번호는 내부에서 직접 조회·복호화한다. 어떤 실패도 던지지 않는다(로그만).
   *
   * @param account 발신 계정
   * @param userId 계정 소유자 ID(비밀번호 조회 스코프)
   * @param message 전송된 MimeMessage
   */
  public void appendQuietly(EmailAccountResponse account, long userId, MimeMessage message) {
    Store store = null;
    try {
      // 암호화된 비밀번호 조회 후 복호화 — 자격증명은 MailSentAppender 가 직접 관리
      String password =
          accountRepo
              .findEncryptedPassword(userId, account.id())
              .map(encryption::decrypt)
              .orElseThrow(() -> new EmailAccountNotFoundException(account.id()));

      store = connect(account, password);
      Folder sent = findSentFolder(store);
      if (sent == null) {
        log.info("Sent 폴더를 찾지 못해 APPEND 생략 (account={})", account.id());
        return;
      }
      message.setFlag(jakarta.mail.Flags.Flag.SEEN, true);
      sent.appendMessages(new Message[] {message});
    } catch (Exception e) {
      // 자격증명 노출 방지를 위해 요약만 기록. 발송은 이미 성공이므로 사용자 영향 없음.
      log.warn("Sent 폴더 APPEND 실패 (account={}): {}", account.id(), e.toString());
    } finally {
      closeQuietly(store);
    }
  }

  /** 후보명 중 존재하는 첫 폴더 반환(없으면 null). */
  private Folder findSentFolder(Store store) throws MessagingException {
    for (String name : SENT_CANDIDATES) {
      Folder f = store.getFolder(name);
      if (f.exists()) {
        return f;
      }
    }
    return null;
  }

  private Store connect(EmailAccountResponse account, String password) throws MessagingException {
    MailSecurity security = account.imapSecurity();
    String protocol = security == MailSecurity.SSL_TLS ? "imaps" : "imap";
    Properties props = new Properties();
    props.put("mail.store.protocol", protocol);
    props.put("mail." + protocol + ".connectiontimeout", String.valueOf(TIMEOUT_MS));
    props.put("mail." + protocol + ".timeout", String.valueOf(TIMEOUT_MS));
    if (security == MailSecurity.STARTTLS) {
      props.put("mail.imap.starttls.enable", "true");
      props.put("mail.imap.starttls.required", "true");
    }
    Session session = Session.getInstance(props);
    Store store = session.getStore(protocol);
    store.connect(account.imapHost(), account.imapPort(), account.imapUsername(), password);
    return store;
  }

  private void closeQuietly(Store store) {
    try {
      if (store != null) {
        store.close();
      }
    } catch (Exception ignored) {
      // RuntimeException 포함 — best-effort 보장
    }
  }
}
