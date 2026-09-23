package com.workplace.drive.exception;

/** 알 수 없는 드라이브 역할 값 지정. → 400. */
public class DriveInvalidRoleException extends RuntimeException {
  public DriveInvalidRoleException(String role) {
    super("올바르지 않은 드라이브 역할입니다 (role: " + role + ")");
  }
}
