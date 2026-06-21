package com.workplace.chat.exception;

/** 첨부 바인딩 검증 실패(미소유·만료·이미바인딩·개수/크기 초과) — 400 으로 매핑. */
public class InvalidChatAttachmentException extends RuntimeException {
  public InvalidChatAttachmentException() {
    super("유효하지 않은 첨부입니다");
  }
}
