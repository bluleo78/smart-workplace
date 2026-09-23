package com.workplace.drive.exception;

/** 드라이브 폴더 미존재 또는 접근 불가. → 404. */
public class DriveFolderNotFoundException extends RuntimeException {
  public DriveFolderNotFoundException(long folderId) {
    super("드라이브 폴더를 찾을 수 없습니다 (id: " + folderId + ")");
  }
}
