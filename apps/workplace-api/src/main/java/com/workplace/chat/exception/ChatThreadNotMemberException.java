package com.workplace.chat.exception;

/** Thread 멤버가 아닌 사용자가 쓰기/읽음 표시 등을 시도. → 403. */
public class ChatThreadNotMemberException extends RuntimeException {
  public ChatThreadNotMemberException(long threadId, long userId) {
    // 내부 id 는 싣지 않는다(WP-564) — 토스트·MCP 응답으로 그대로 보인다. 프로젝트가 지워진 원래 멤버에게도 맞게 「참여하지 않음」이라 단정하지 않는다.
    super("이 대화에 접근할 권한이 없습니다");
  }
}
