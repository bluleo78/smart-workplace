package com.workplace.mail.service;

import com.workplace.mail.dto.EmailAccountResponse;
import com.workplace.mail.dto.MailSecurity;
import jakarta.mail.MessagingException;
import jakarta.mail.Session;
import jakarta.mail.Store;
import java.util.Properties;
import org.springframework.stereotype.Component;

/** IMAP Store 연결 공용 컴포넌트. 동기화와 본문 OnDemand/백그라운드 적재가 동일한 보안/타임아웃 정책으로 연결하도록 한다. */
@Component
public class ImapConnector {

  /** 연결·읽기 타임아웃(ms) — 행 방지. */
  public static final int TIMEOUT_MS = 10_000;

  /** IMAP Store 연결. 호출 측이 store.close() 책임. */
  public Store connect(EmailAccountResponse account, String password) throws MessagingException {
    MailSecurity security = account.imapSecurity();
    String protocol = security == MailSecurity.SSL_TLS ? "imaps" : "imap";
    Properties props = new Properties();
    props.put("mail.store.protocol", protocol);
    props.put("mail." + protocol + ".connectiontimeout", String.valueOf(TIMEOUT_MS));
    props.put("mail." + protocol + ".timeout", String.valueOf(TIMEOUT_MS));
    // 비표준 주소 헤더에 관대하게 — strict 파싱은 정상 메일도 거부할 수 있다.
    props.put("mail.mime.address.strict", "false");
    if (security == MailSecurity.STARTTLS) {
      props.put("mail.imap.starttls.enable", "true");
      props.put("mail.imap.starttls.required", "true");
    }
    Session session = Session.getInstance(props);
    Store store = session.getStore(protocol);
    store.connect(account.imapHost(), account.imapPort(), account.imapUsername(), password);
    return store;
  }
}
