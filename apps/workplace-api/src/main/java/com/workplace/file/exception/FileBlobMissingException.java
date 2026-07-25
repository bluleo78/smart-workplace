package com.workplace.file.exception;

/**
 * {@code file} 행은 존재하나 디스크 blob 이 유실된 경우(#739). {@link FileNotFoundException}(행 자체가 없음)과 구분해,
 * 클라이언트가 "원본 복구 불가"를 명확히 안내할 수 있게 한다.
 */
public class FileBlobMissingException extends RuntimeException {
  public FileBlobMissingException(Long fileId) {
    super("File blob missing on disk: " + fileId);
  }
}
