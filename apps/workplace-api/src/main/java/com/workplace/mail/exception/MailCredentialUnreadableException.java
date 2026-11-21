package com.workplace.mail.exception;

import com.workplace.mail.service.MailServerErrors;

/**
 * 저장된 메일 계정 자격증명(IMAP 비밀번호·Microsoft 365 토큰)을 복호화하지 못했다(WP-1907) — 서버에 접속하기 전에 실패하며, 사용자가 계정을 다시
 * 연결해야 풀린다. {@link MailSyncException}(502)을 상속해 기존 502 응답은 그대로 두고, 비우기 작업처럼 사유 코드가 필요한 곳이 「연결 실패」와
 * 구분하도록 {@link #trashCode()} 를 제공한다. 메시지·로그에 암호문·키·토큰은 싣지 않는다.
 */
public class MailCredentialUnreadableException extends MailSyncException {

  private final String trashCode;

  private MailCredentialUnreadableException(String message, String trashCode, Throwable cause) {
    super(message, cause);
    this.trashCode = trashCode;
  }

  /** IMAP 계정 비밀번호를 읽지 못했다. */
  public static MailCredentialUnreadableException password(Throwable cause) {
    return new MailCredentialUnreadableException(
        MailServerErrors.CREDENTIAL_UNREADABLE, MailTrashException.CREDENTIAL_UNREADABLE, cause);
  }

  /** Microsoft 365 계정 토큰을 읽지 못했다(cause 는 null 일 수 있다 — 토큰이 행에 없는 경우). */
  public static MailCredentialUnreadableException oauthToken(Throwable cause) {
    return new MailCredentialUnreadableException(
        MailServerErrors.OAUTH_TOKEN_UNREADABLE, MailTrashException.OAUTH_TOKEN_UNREADABLE, cause);
  }

  /** 휴지통 비우기 작업 FAILED 사유 코드({@link MailTrashException}). */
  public String trashCode() {
    return trashCode;
  }
}
