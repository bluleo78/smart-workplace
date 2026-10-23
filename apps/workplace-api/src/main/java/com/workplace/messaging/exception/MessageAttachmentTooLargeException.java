package com.workplace.messaging.exception;

import com.workplace.file.exception.FileSizeLimitExceededException;

/** 첨부 파일이 크기 한도를 초과. → 400 */
public class MessageAttachmentTooLargeException extends RuntimeException {
  /** 웹이 토스트로 그대로 보여 주므로 바이트 수 대신 MB 한도와 파일 이름으로 알린다(WP-848). */
  public MessageAttachmentTooLargeException(String fileName, long limit) {
    super(FileSizeLimitExceededException.attachmentMessage(limit, fileName));
  }
}
