package com.workplace.chat.exception;

/** 메시지 id 미존재 또는 soft-deleted. → 404. */
public class ChatMessageNotFoundException extends RuntimeException {
  public ChatMessageNotFoundException(long id) {
    super("메시지를 찾을 수 없습니다 (id: " + id + ")");
  }
}
