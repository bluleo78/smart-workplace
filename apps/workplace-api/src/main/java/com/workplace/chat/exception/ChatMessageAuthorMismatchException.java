package com.workplace.chat.exception;

/** 본인이 아닌 메시지의 수정/삭제 시도. → 403. */
public class ChatMessageAuthorMismatchException extends RuntimeException {
  public ChatMessageAuthorMismatchException(long messageId, long callerId) {
    super("user " + callerId + " is not the author of chat message " + messageId);
  }
}
