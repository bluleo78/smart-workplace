package com.workplace.drive.exception;

public class DriveInvalidRoleException extends RuntimeException {
  public DriveInvalidRoleException(String role) {
    super("invalid drive role: " + role);
  }
}
