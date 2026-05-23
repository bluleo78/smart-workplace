package com.workplace.issue.exception;

/** 개별 첨부 파일이 사이즈 한도(25MB)를 초과한 경우 — HTTP 400 매핑. */
public class AttachmentTooLargeException extends RuntimeException {

  /** 실제 사이즈와 한도를 메시지에 포함해 디버깅에 활용. */
  public AttachmentTooLargeException(long sizeBytes, long limit) {
    super("첨부 파일이 " + (limit / (1024 * 1024)) + "MB 한도를 초과했습니다 (" + sizeBytes + " bytes)");
  }
}
