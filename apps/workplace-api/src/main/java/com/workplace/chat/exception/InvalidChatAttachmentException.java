package com.workplace.chat.exception;

/** 첨부 바인딩 검증 실패(미소유·만료·이미바인딩·개수/크기 초과) — 400 으로 매핑. */
public class InvalidChatAttachmentException extends RuntimeException {
  public InvalidChatAttachmentException() {
    super("유효하지 않은 첨부입니다");
  }

  /** 사용자가 고칠 수 있는 이유(크기·개수 초과)는 그 이유를 알린다 — 「유효하지 않은 첨부」만으로는 왜 안 되는지 몰랐다(WP-848). */
  public InvalidChatAttachmentException(String message) {
    super(message);
  }

  /** 메시지당 첨부 개수 초과 — 채널 메시지(MessageAttachmentLimitExceededException)와 같은 문구. */
  public static InvalidChatAttachmentException tooMany(int max) {
    return new InvalidChatAttachmentException("메시지당 첨부 한도(" + max + "개)를 초과합니다");
  }
}
