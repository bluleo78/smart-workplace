package com.workplace.issue.exception;

import com.workplace.file.exception.FileSizeLimitExceededException;

/** 개별 첨부 파일이 사이즈 한도(25MB)를 초과한 경우 — HTTP 400 매핑. */
public class AttachmentTooLargeException extends RuntimeException {

  /** 웹이 토스트로 그대로 보여 주므로 바이트 수 대신 MB 한도와 파일 이름으로 알린다(WP-848). */
  public AttachmentTooLargeException(String fileName, long limit) {
    super(FileSizeLimitExceededException.attachmentMessage(limit, fileName));
  }
}
