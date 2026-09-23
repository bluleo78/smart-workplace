package com.workplace.messaging.exception;

/** 본인이 아닌 메시지를 수정/삭제 시도. → 403. */
public class MessageAuthorMismatchException extends RuntimeException {
  public MessageAuthorMismatchException(long messageId, long callerId) {
    super("본인이 작성한 메시지만 수정·삭제할 수 있습니다 (messageId: " + messageId + ", userId: " + callerId + ")");
  }
}
