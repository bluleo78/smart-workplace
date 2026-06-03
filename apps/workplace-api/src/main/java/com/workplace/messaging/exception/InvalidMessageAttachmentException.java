package com.workplace.messaging.exception;

/** 바인딩 검증 실패(타 유저 소유/이미 바인딩됨/만료/존재하지 않음). → 400 */
public class InvalidMessageAttachmentException extends RuntimeException {
  public InvalidMessageAttachmentException(Long fileId) {
    super("첨부할 수 없는 파일입니다: " + fileId);
  }
}
