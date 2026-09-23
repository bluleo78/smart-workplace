package com.workplace.drive.exception;

/** PERSONAL/CHANNEL 공간에 대한 이름 변경·삭제 시도 — TEAM 공간만 허용. HTTP 409. */
public class DriveSpaceTypeNotEditableException extends RuntimeException {
  public DriveSpaceTypeNotEditableException(long spaceId, String type) {
    super("팀 공간만 이름을 바꾸거나 삭제할 수 있습니다 (spaceId: " + spaceId + ", type: " + type + ")");
  }
}
