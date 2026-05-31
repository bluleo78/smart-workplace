package com.workplace.home.exception;

import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.ResponseStatus;

/** ai-agent 연동 비활성(enabled=false) 시 compose 불가. */
@ResponseStatus(HttpStatus.SERVICE_UNAVAILABLE)
public class HomeComposeUnavailableException extends RuntimeException {
  public HomeComposeUnavailableException(String message) {
    super(message);
  }
}
