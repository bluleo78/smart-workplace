package com.workplace.messaging.exception;

/** 첨부 파일이 크기 한도를 초과. → 400 */
public class MessageAttachmentTooLargeException extends RuntimeException {
  public MessageAttachmentTooLargeException(long sizeBytes, long limit) {
    super("첨부 파일이 " + (limit / (1024 * 1024)) + "MB 한도를 초과했습니다 (" + sizeBytes + " bytes)");
  }
}
