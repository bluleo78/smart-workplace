package com.workplace.mail.exception;

import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.ResponseStatus;

/** 본인 소유가 아니거나 존재하지 않는 첨부 파일 — 존재 노출 방지를 위해 404. */
@ResponseStatus(HttpStatus.NOT_FOUND)
public class EmailAttachmentNotFoundException extends RuntimeException {
  public EmailAttachmentNotFoundException(long id) {
    super("첨부 파일을 찾을 수 없습니다: " + id);
  }
}
