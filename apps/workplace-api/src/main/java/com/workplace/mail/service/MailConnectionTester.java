package com.workplace.mail.service;

import com.workplace.mail.dto.ConnectionTestResult;
import com.workplace.mail.dto.MailSecurity;
import jakarta.mail.AuthenticationFailedException;
import jakarta.mail.MessagingException;
import jakarta.mail.Session;
import jakarta.mail.Store;
import jakarta.mail.Transport;
import java.net.ConnectException;
import java.net.UnknownHostException;
import java.util.Properties;
import javax.net.ssl.SSLException;
import org.springframework.stereotype.Component;

/**
 * IMAP/SMTP 에 실제 접속해 호스트·포트·보안·자격증명을 검증한다. 메일 페치/발송은 하지 않고 connect/close 만 수행한다. 행(hang) 방지를
 * 위해 연결·읽기 타임아웃을 10초로 제한한다. Spring 빈이지만 외부 의존이 없어 단위 테스트에서 직접 new 로 생성 가능하다.
 */
@Component
public class MailConnectionTester {

  /** 연결·읽기 타임아웃(ms). */
  private static final int TIMEOUT_MS = 10_000;

  /** IMAP·SMTP 를 각각 검증해 합쳐서 반환. */
  public ConnectionTestResult test(
      String imapHost,
      int imapPort,
      MailSecurity imapSecurity,
      String imapUsername,
      String smtpHost,
      int smtpPort,
      MailSecurity smtpSecurity,
      String smtpUsername,
      String password) {
    String imapError = testImap(imapHost, imapPort, imapSecurity, imapUsername, password);
    String smtpError = testSmtp(smtpHost, smtpPort, smtpSecurity, smtpUsername, password);
    return new ConnectionTestResult(imapError == null, imapError, smtpError == null, smtpError);
  }

  /** IMAP 접속 시도. 성공이면 null, 실패면 사용자 친화 에러 메시지 반환. */
  private String testImap(
      String host, int port, MailSecurity security, String username, String password) {
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
    try (Store store = session.getStore(protocol)) {
      store.connect(host, port, username, password);
      return null;
    } catch (AuthenticationFailedException e) {
      return "인증 실패 — 사용자명 또는 비밀번호를 확인하세요";
    } catch (MessagingException e) {
      return classify(e);
    }
  }

  /** SMTP 접속 시도. 성공이면 null, 실패면 사용자 친화 에러 메시지 반환. */
  private String testSmtp(
      String host, int port, MailSecurity security, String username, String password) {
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
    Session session = Session.getInstance(props);
    try (Transport transport = session.getTransport("smtp")) {
      transport.connect(host, port, username, password);
      return null;
    } catch (AuthenticationFailedException e) {
      return "인증 실패 — 사용자명 또는 비밀번호를 확인하세요";
    } catch (MessagingException e) {
      return classify(e);
    }
  }

  /** 예외 원인을 사용자 친화 메시지로 분류. */
  private String classify(MessagingException e) {
    Throwable cause = e.getCause();
    if (cause instanceof UnknownHostException) {
      return "호스트를 찾을 수 없습니다 — 주소를 확인하세요";
    }
    if (cause instanceof ConnectException) {
      return "서버에 연결할 수 없습니다 — 호스트/포트를 확인하세요";
    }
    if (cause instanceof SSLException) {
      return "TLS/SSL 오류 — 보안 방식을 확인하세요";
    }
    if (cause instanceof java.net.SocketTimeoutException) {
      return "연결 시간 초과 — 호스트/포트를 확인하세요";
    }
    return "연결 실패 — " + e.getMessage();
  }
}
