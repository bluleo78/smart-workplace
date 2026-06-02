package com.workplace.messaging.exception;

/** 스레드 부모로 부적합(미존재·타 채널·이미 답글=대댓글 금지). → 400. */
public class InvalidThreadParentException extends RuntimeException {
  public InvalidThreadParentException(long parentId) {
    super("message " + parentId + " is not a valid thread parent");
  }
}
