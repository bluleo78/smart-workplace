package com.workplace.mail.exception;

import org.springframework.web.client.ResourceAccessException;

/** ai-agent 메일 호출 실패(IO/4xx/5xx) — 502 로 매핑. */
public class MailAiException extends RuntimeException {
  public MailAiException(String message, Throwable cause) {
    super(message, cause);
  }

  /**
   * 일시 장애 여부 — 연결·읽기 타임아웃(클라이언트가 감싼 {@link ResourceAccessException} 원인)이면 agent 장애로 본다. 그 외(파싱
   * 실패·4xx 등)는 메일 단위 실패다. 503({@link MailAiUnavailableException})은 별도 예외 타입이라 호출부가 함께 판정한다 — 분류 규칙은
   * 이 두 곳뿐이다.
   */
  public boolean isTransient() {
    return getCause() instanceof ResourceAccessException;
  }
}
