package com.workplace.chat.exception;

/** 원본 이슈가 소프트삭제된 스레드에 메시지 전송을 시도 (#621). → 404. */
public class ChatThreadIssueDeletedException extends RuntimeException {
  public ChatThreadIssueDeletedException(long threadId) {
    super("삭제된 이슈의 대화에는 메시지를 보낼 수 없습니다 (threadId: " + threadId + ")");
  }
}
