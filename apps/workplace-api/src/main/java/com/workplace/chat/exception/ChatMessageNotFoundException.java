package com.workplace.chat.exception;

/** 메시지 id 미존재 또는 soft-deleted. → 404. */
public class ChatMessageNotFoundException extends RuntimeException {
  public ChatMessageNotFoundException(long id) {
    super("chat message not found: " + id);
  }
}
