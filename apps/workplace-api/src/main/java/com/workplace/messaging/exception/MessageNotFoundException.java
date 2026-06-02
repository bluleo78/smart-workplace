package com.workplace.messaging.exception;

/** 메시지 id 미존재 또는 soft-deleted. → 404. */
public class MessageNotFoundException extends RuntimeException {
  public MessageNotFoundException(long messageId) {
    super("message " + messageId + " not found");
  }
}
