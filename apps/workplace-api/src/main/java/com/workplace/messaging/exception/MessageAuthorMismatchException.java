package com.workplace.messaging.exception;

/** 본인이 아닌 메시지를 수정/삭제 시도. → 403. */
public class MessageAuthorMismatchException extends RuntimeException {
  public MessageAuthorMismatchException(long messageId, long callerId) {
    super("caller " + callerId + " is not the author of message " + messageId);
  }
}
