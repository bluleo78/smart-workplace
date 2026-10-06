package com.workplace.home.exception;

import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.ResponseStatus;

/**
 * 메인 AI 채팅 첨부 요청이 받아들일 수 없음(WP-234) — 400. 메시지는 사용자에게 그대로 보이는 한국어 문구다(웹이 토스트로 표시). 존재 노출을 막기 위해
 * 없는·남의·만료된 파일은 같은 문구를 쓴다.
 */
@ResponseStatus(HttpStatus.BAD_REQUEST)
public class HomeAttachmentInvalidException extends RuntimeException {
  public HomeAttachmentInvalidException(String message) {
    super(message);
  }
}
