package com.workplace.drive.exception;

/** 공간 멤버지만 요구 역할 미달, 또는 링크 조작 권한 없음. */
public class DriveForbiddenException extends RuntimeException {
  public DriveForbiddenException(long spaceId, long userId) {
    super("user " + userId + " forbidden in drive space " + spaceId);
  }

  /** 링크 조작 등 공간 외 금지 상황에서 메시지로 직접 생성. */
  public DriveForbiddenException(String message) {
    super(message);
  }
}
