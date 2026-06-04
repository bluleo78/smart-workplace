package com.workplace.mail.exception;

/** ai-agent 메일 호출 실패(IO/4xx/5xx) — 502 로 매핑. */
public class MailAiException extends RuntimeException {
  public MailAiException(String message, Throwable cause) {
    super(message, cause);
  }
}
