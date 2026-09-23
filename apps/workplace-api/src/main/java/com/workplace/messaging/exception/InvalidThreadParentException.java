package com.workplace.messaging.exception;

/** 스레드 부모로 부적합(미존재·타 채널·이미 답글=대댓글 금지). → 400. */
public class InvalidThreadParentException extends RuntimeException {
  public InvalidThreadParentException(long parentId) {
    super("스레드를 달 수 없는 메시지입니다 — 없거나 다른 채널의 메시지이거나 이미 답글입니다 (parentId: " + parentId + ")");
  }
}
