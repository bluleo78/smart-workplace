package com.workplace.mail.exception;

import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.ResponseStatus;

/** 같은 사용자가 같은 이메일 주소를 이미 등록함. */
@ResponseStatus(HttpStatus.CONFLICT)
public class DuplicateEmailAccountException extends RuntimeException {
  public DuplicateEmailAccountException(String emailAddress) {
    super("이미 등록된 메일 주소입니다: " + emailAddress);
  }
}
