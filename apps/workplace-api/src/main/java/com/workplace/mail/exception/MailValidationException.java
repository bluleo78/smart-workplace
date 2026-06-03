package com.workplace.mail.exception;

import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.ResponseStatus;

/** 비즈니스 검증 실패(예: 생성 시 비밀번호 누락). */
@ResponseStatus(HttpStatus.BAD_REQUEST)
public class MailValidationException extends RuntimeException {
  public MailValidationException(String message) {
    super(message);
  }
}
