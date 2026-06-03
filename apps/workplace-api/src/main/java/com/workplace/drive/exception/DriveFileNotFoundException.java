package com.workplace.drive.exception;

public class DriveFileNotFoundException extends RuntimeException {
  public DriveFileNotFoundException(long driveFileId) {
    super("drive file " + driveFileId + " not found");
  }
}
