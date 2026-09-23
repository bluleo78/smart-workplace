package com.workplace.chat.exception;

/** 본인이 아닌 메시지의 수정/삭제 시도. → 403. */
public class ChatMessageAuthorMismatchException extends RuntimeException {
  public ChatMessageAuthorMismatchException(long messageId, long callerId) {
    super("본인이 작성한 메시지만 수정·삭제할 수 있습니다 (messageId: " + messageId + ", userId: " + callerId + ")");
  }
}
