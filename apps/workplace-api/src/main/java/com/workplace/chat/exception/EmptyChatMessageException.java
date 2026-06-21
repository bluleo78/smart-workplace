package com.workplace.chat.exception;

/** 본문도 첨부도 드라이브 링크도 없는 메시지 작성 시도 — 400 으로 매핑. */
public class EmptyChatMessageException extends RuntimeException {
  public EmptyChatMessageException() {
    super("메시지 본문 또는 첨부가 필요합니다");
  }
}
