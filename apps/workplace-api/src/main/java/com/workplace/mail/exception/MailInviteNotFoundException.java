package com.workplace.mail.exception;

import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.ResponseStatus;

/**
 * 일정 초대가 없는 메일에 초대 응답을 보냄(WP-986) — 404. 메일 자체가 없거나 남의 것이면 {@link EmailMessageNotFoundException}.
 */
@ResponseStatus(HttpStatus.NOT_FOUND)
public class MailInviteNotFoundException extends RuntimeException {
  public MailInviteNotFoundException() {
    super("이 메일에는 일정 초대가 없습니다");
  }
}
