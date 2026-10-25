package com.workplace.mail.exception;

import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.ResponseStatus;

/** 본인 계정의 메일함이 아니거나 없는 메일함(WP-960) — 존재 노출 방지를 위해 404. */
@ResponseStatus(HttpStatus.NOT_FOUND)
public class EmailFolderNotFoundException extends RuntimeException {
  public EmailFolderNotFoundException() {
    // 문구에 id 를 넣지 않는다 — 응답 message 로 그대로 나간다(WP-619 와 같은 이유)
    super("메일함을 찾을 수 없습니다");
  }
}
