package com.workplace.drive.exception;

public class DriveDuplicateNameException extends RuntimeException {
  public DriveDuplicateNameException(String name) {
    super("duplicate name in folder: " + name);
  }
}
