package com.workplace.auth.exception;

import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.ResponseStatus;

/** 개인·공용 비서가 모두 미설정(또는 active 토큰 없음)일 때. 명확한 503 으로 노출. */
@ResponseStatus(HttpStatus.SERVICE_UNAVAILABLE)
public class HomeAssistantNotConfiguredException extends RuntimeException {
  public HomeAssistantNotConfiguredException(String message) {
    super(message);
  }
}
