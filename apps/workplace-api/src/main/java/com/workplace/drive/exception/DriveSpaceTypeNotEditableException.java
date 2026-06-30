package com.workplace.drive.exception;

/** PERSONAL/CHANNEL 공간에 대한 이름 변경·삭제 시도 — TEAM 공간만 허용. HTTP 409. */
public class DriveSpaceTypeNotEditableException extends RuntimeException {
  public DriveSpaceTypeNotEditableException(long spaceId, String type) {
    super("drive space " + spaceId + " of type " + type + " cannot be renamed or deleted");
  }
}
