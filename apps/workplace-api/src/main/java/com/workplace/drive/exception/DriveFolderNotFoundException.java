package com.workplace.drive.exception;

public class DriveFolderNotFoundException extends RuntimeException {
  public DriveFolderNotFoundException(long folderId) {
    super("drive folder " + folderId + " not found");
  }
}
