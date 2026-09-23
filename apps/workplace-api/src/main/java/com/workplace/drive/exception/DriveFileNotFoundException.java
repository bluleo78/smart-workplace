package com.workplace.drive.exception;

/** 드라이브 파일 미존재 또는 접근 불가. → 404. */
public class DriveFileNotFoundException extends RuntimeException {
  public DriveFileNotFoundException(long driveFileId) {
    super("드라이브 파일을 찾을 수 없습니다 (id: " + driveFileId + ")");
  }
}
