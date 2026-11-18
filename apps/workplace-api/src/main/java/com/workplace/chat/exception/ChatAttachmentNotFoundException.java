package com.workplace.chat.exception;

/** 스레드 첨부가 아니거나 없는 fileId — 404(WP-242 구간 읽기). */
public class ChatAttachmentNotFoundException extends RuntimeException {
  public ChatAttachmentNotFoundException(long fileId) {
    super("채팅 첨부를 찾을 수 없습니다"); // 내부 id 없음(WP-564)
  }

  /** 호출 경로에 맞춘 문구로 — 스테이징 복사가 다음 할 일(이슈 첨부는 source issue)을 안내할 때 쓴다(WP-1705). 내부 id 는 넣지 않는다. */
  public ChatAttachmentNotFoundException(String message) {
    super(message);
  }
}
