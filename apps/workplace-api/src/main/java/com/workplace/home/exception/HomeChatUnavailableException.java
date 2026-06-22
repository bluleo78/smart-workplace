package com.workplace.home.exception;

import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.ResponseStatus;

/** ai-agent 연동 비활성(enabled=false) 시 채팅 불가. */
@ResponseStatus(HttpStatus.SERVICE_UNAVAILABLE)
public class HomeChatUnavailableException extends RuntimeException {
  public HomeChatUnavailableException(String message) {
    super(message);
  }
}
