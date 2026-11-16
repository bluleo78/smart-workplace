package com.workplace.mail.service;

import com.workplace.mail.dto.EmailAccountResponse;
import com.workplace.mail.dto.MailSecurity;
import jakarta.mail.MessagingException;
import jakarta.mail.Session;
import jakarta.mail.Store;
import java.util.Properties;
import lombok.RequiredArgsConstructor;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

/** IMAP Store 연결 공용 컴포넌트. 동기화와 본문 OnDemand/백그라운드 적재가 동일한 보안/타임아웃 정책으로 연결하도록 한다. */
@Component
@RequiredArgsConstructor
public class ImapConnector {

  /** 운영 기본 연결·읽기 타임아웃(ms) — 설정이 없을 때의 값이며, 직접 new 하는 단위 테스트도 이 값을 넘긴다. */
  public static final int DEFAULT_TIMEOUT_MS = 10_000;

  /**
   * 메일 I/O 타임아웃 설정 자리표시자 — 메일 클라이언트 네 곳(이 클래스·연결 시험·보낸편지함 저장·SMTP 발송)이 같은 키·기본값을 읽게 한 곳에
   * 둔다(WP-1641).
   */
  public static final String IO_TIMEOUT_PROPERTY =
      "${workplace.mail.io-timeout-ms:" + DEFAULT_TIMEOUT_MS + "}";

  /**
   * 연결·읽기 타임아웃(ms) — 행 방지. 설정 {@code workplace.mail.io-timeout-ms}, 기본 10초(운영). test 프로필은 2분으로 올려
   * 테스트 JVM 이 잠시 멈춰도 메일 테스트가 시간 제한으로 깨지지 않게 한다(WP-1641).
   */
  @Value(ImapConnector.IO_TIMEOUT_PROPERTY)
  private final int ioTimeoutMs;

  /** 적용 중인 연결·읽기 타임아웃(ms) — 설정 주입 검증용. */
  int ioTimeoutMs() {
    return ioTimeoutMs;
  }

  /** IMAP Store 연결. 호출 측이 store.close() 책임. */
  public Store connect(EmailAccountResponse account, String password) throws MessagingException {
    MailSecurity security = account.imapSecurity();
    String protocol = security == MailSecurity.SSL_TLS ? "imaps" : "imap";
    Properties props = new Properties();
    props.put("mail.store.protocol", protocol);
    props.put("mail." + protocol + ".connectiontimeout", String.valueOf(ioTimeoutMs));
    props.put("mail." + protocol + ".timeout", String.valueOf(ioTimeoutMs));
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
