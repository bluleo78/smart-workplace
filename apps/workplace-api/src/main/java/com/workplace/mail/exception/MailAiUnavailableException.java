package com.workplace.mail.exception;

/** ai-agent 메일 기능 미설정/일시 불가(503) — 사용자 친화 메시지. */
public class MailAiUnavailableException extends RuntimeException {
  public MailAiUnavailableException(String message) {
    super(message);
  }
}
