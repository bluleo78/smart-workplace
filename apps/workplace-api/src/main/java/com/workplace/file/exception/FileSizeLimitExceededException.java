package com.workplace.file.exception;

/** 카테고리별 파일 크기 한도 초과 — HTTP 400 매핑. */
public class FileSizeLimitExceededException extends RuntimeException {
  public FileSizeLimitExceededException(String category, long maxBytes) {
    super(String.format("%s 파일은 최대 %dMB까지 업로드할 수 있습니다", category, maxBytes / (1024 * 1024)));
  }
}
