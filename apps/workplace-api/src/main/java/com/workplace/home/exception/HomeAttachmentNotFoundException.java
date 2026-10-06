package com.workplace.home.exception;

import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.ResponseStatus;

/** 그 세션에 연결된 첨부가 아님(WP-234) — 다른 세션·없는 파일 모두 404 로 통일해 존재를 드러내지 않는다. */
@ResponseStatus(HttpStatus.NOT_FOUND)
public class HomeAttachmentNotFoundException extends RuntimeException {
  public HomeAttachmentNotFoundException(long fileId) {
    super("대화 첨부를 찾을 수 없습니다: " + fileId);
  }
}
