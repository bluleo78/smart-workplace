package com.workplace.drive.exception;

/** 공간 멤버지만 요구 역할 미달. */
public class DriveForbiddenException extends RuntimeException {
  public DriveForbiddenException(long spaceId, long userId) {
    super("user " + userId + " forbidden in drive space " + spaceId);
  }
}
