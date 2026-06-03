package com.workplace.mail.exception;

import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.ResponseStatus;

/** IMAP 동기화 중 상위(메일 서버) 오류 — 502. 자격증명/네트워크/프로토콜 실패를 포괄한다. */
@ResponseStatus(HttpStatus.BAD_GATEWAY)
public class MailSyncException extends RuntimeException {
  public MailSyncException(String message, Throwable cause) {
    super(message, cause);
  }
}
