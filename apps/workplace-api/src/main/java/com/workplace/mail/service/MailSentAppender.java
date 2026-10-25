package com.workplace.mail.service;

import com.workplace.mail.dto.EmailAccountResponse;
import com.workplace.mail.dto.MailSecurity;
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
 * 자체는 이미 성공). 폴더는 SPECIAL-USE({@code \Sent}) 표시 → 흔한 Sent 이름 후보 순으로 찾는다(ImapSentFolderLocator —
 * 보낸편지함 동기화와 같은 폴더, WP-950).
 *
 * <p>비밀번호 복호화는 이 클래스 내에서 직접 수행한다(MailComposeService 에서 비번 의존 제거).
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class MailSentAppender {

  private static final int TIMEOUT_MS = 10_000;

  private final MailAccountCredentials credentials;

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
      // 자격증명 조회(RLS 읽기 트랜잭션)는 MailAccountCredentials 가 맡고, 여기서는 I/O 만 한다(WP-574).
      String password = credentials.password(userId, account.id());

      store = connect(account, password);
      // 동기화가 찾아 둔 보낸편지함 이름을 먼저 — 보낼 때마다 전체 폴더 목록(LIST)을 받지 않게(WP-950).
      Folder sent =
          ImapSentFolderLocator.find(store, credentials.serverSentFolderName(account.id()));
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
