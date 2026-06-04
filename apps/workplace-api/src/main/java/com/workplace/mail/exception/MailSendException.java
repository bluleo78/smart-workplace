package com.workplace.mail.exception;

import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.ResponseStatus;

/** SMTP 발송 실패 — 상위(메일 서버) 오류이므로 502. 인증/네트워크/수신거부를 포괄한다. */
@ResponseStatus(HttpStatus.BAD_GATEWAY)
public class MailSendException extends RuntimeException {
  public MailSendException(String message, Throwable cause) {
    super(message, cause);
  }
}
