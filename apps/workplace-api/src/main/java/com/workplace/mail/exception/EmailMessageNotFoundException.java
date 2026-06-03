package com.workplace.mail.exception;

import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.ResponseStatus;

/** 본인 소유가 아니거나 존재하지 않는 메일 메시지 — 존재 노출 방지를 위해 404. */
@ResponseStatus(HttpStatus.NOT_FOUND)
public class EmailMessageNotFoundException extends RuntimeException {
  public EmailMessageNotFoundException(long id) {
    super("메일 메시지를 찾을 수 없습니다: " + id);
  }
}
