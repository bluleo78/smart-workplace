package com.workplace.drive.exception;

/** 비밀번호 누락/불일치 또는 사내 링크에 미인증/타테넌트 접근. → 401 */
public class DriveShareLinkUnauthorizedException extends RuntimeException {
  public DriveShareLinkUnauthorizedException(String message) {
    super(message);
  }
}
