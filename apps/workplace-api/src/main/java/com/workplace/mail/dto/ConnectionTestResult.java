package com.workplace.mail.dto;

/**
 * IMAP/SMTP 연결 테스트 결과. 각 프로토콜 성공 여부와(실패 시) 사용자 친화 에러 메시지를 담는다.
 *
 * @param imapError imapOk 가 false 일 때만 채워진다(아니면 null)
 * @param smtpError smtpOk 가 false 일 때만 채워진다(아니면 null)
 */
public record ConnectionTestResult(
    boolean imapOk, String imapError, boolean smtpOk, String smtpError) {

  /** IMAP·SMTP 둘 다 성공해야 전체 성공. */
  public boolean success() {
    return imapOk && smtpOk;
  }
}
