package com.workplace.messaging.exception;

/** ai-agent 메시징 분류 호출 실패(IO/4xx/5xx) — 502 로 매핑. */
public class MessagingAiException extends RuntimeException {
  public MessagingAiException(String message, Throwable cause) {
    super(message, cause);
  }
}
