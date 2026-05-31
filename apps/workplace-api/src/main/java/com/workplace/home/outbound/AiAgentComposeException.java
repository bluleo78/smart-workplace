package com.workplace.home.outbound;

import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.ResponseStatus;

/** ai-agent 컴포즈 호출 실패 — 게이트웨이 오류로 매핑. */
@ResponseStatus(HttpStatus.BAD_GATEWAY)
public class AiAgentComposeException extends RuntimeException {
  public AiAgentComposeException(String message, Throwable cause) {
    super(message, cause);
  }
}
