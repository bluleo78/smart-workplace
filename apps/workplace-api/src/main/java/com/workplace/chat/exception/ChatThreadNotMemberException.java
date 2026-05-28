package com.workplace.chat.exception;

/** Thread 멤버가 아닌 사용자가 쓰기/읽음 표시 등을 시도. → 403. */
public class ChatThreadNotMemberException extends RuntimeException {
  public ChatThreadNotMemberException(long threadId, long userId) {
    super("user " + userId + " is not a member of chat thread " + threadId);
  }
}
