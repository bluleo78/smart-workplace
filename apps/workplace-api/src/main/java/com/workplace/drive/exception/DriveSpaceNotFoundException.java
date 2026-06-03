package com.workplace.drive.exception;

public class DriveSpaceNotFoundException extends RuntimeException {
  public DriveSpaceNotFoundException(long spaceId) {
    super("drive space " + spaceId + " not found");
  }
}
