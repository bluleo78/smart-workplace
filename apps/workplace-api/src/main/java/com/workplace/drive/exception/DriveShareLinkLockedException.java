package com.workplace.drive.exception;

/** 공유 링크 비밀번호 연속 실패로 잠금됨(#700). → 429 Too Many Requests */
public class DriveShareLinkLockedException extends RuntimeException {
  public DriveShareLinkLockedException(String message) {
    super(message);
  }
}
