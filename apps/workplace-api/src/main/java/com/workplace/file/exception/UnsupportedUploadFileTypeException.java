package com.workplace.file.exception;

/** 허용되지 않은 MIME 타입 업로드 시도 — HTTP 400 매핑. */
public class UnsupportedUploadFileTypeException extends RuntimeException {
  public UnsupportedUploadFileTypeException(String mimeType) {
    super("지원하지 않는 파일 형식입니다: " + mimeType);
  }
}
