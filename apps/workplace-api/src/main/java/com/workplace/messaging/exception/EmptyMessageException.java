package com.workplace.messaging.exception;

/** 본문도 첨부도 없는 빈 메시지. → 400 */
public class EmptyMessageException extends RuntimeException {
  public EmptyMessageException() {
    super("본문 또는 첨부 중 하나는 있어야 합니다");
  }
}
