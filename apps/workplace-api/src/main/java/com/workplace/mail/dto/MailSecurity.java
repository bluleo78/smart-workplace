package com.workplace.mail.dto;

/** IMAP/SMTP 전송 보안 방식. DB 의 imap_security/smtp_security(VARCHAR) 와 name() 으로 매핑. */
public enum MailSecurity {
  /** 평문(보안 없음) — 로컬/테스트용. */
  NONE,
  /** 평문 연결 후 STARTTLS 로 업그레이드. */
  STARTTLS,
  /** 처음부터 TLS(implicit SSL). IMAP 993 / SMTP 465 등. */
  SSL_TLS
}
