package com.workplace.chat.exception;

/** Thread 멤버가 아닌 사용자가 쓰기/읽음 표시 등을 시도. → 403. */
public class ChatThreadNotMemberException extends RuntimeException {
  public ChatThreadNotMemberException(long threadId, long userId) {
    super("대화에 참여하지 않은 사용자입니다 (threadId: " + threadId + ", userId: " + userId + ")");
  }
}
