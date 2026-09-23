package com.workplace.drive.exception;

/** 드라이브 공간 미존재 또는 비멤버 접근(존재 은닉). → 404. */
public class DriveSpaceNotFoundException extends RuntimeException {
  public DriveSpaceNotFoundException(long spaceId) {
    super("드라이브 공간을 찾을 수 없습니다 (id: " + spaceId + ")");
  }
}
