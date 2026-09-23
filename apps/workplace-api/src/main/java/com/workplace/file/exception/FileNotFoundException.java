package com.workplace.file.exception;

/** 파일 행 미존재(존재하지 않거나 접근 불가). → 404. */
public class FileNotFoundException extends RuntimeException {
  public FileNotFoundException(Long fileId) {
    super("파일을 찾을 수 없습니다 (fileId: " + fileId + ")");
  }
}
