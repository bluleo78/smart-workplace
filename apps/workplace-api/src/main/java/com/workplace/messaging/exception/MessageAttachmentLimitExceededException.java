package com.workplace.messaging.exception;

/** 메시지당 첨부 개수 한도 초과. → 409 */
public class MessageAttachmentLimitExceededException extends RuntimeException {
  public MessageAttachmentLimitExceededException(int adding, int max) {
    super("메시지당 첨부 한도(" + max + "개)를 초과합니다: 신규 " + adding);
  }
}
