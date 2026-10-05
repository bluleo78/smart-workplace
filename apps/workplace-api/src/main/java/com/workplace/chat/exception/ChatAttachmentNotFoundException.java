package com.workplace.chat.exception;

/** 스레드 첨부가 아니거나 없는 fileId — 404(WP-242 구간 읽기). */
public class ChatAttachmentNotFoundException extends RuntimeException {
  public ChatAttachmentNotFoundException(long fileId) {
    super("채팅 첨부를 찾을 수 없습니다: " + fileId);
  }
}
