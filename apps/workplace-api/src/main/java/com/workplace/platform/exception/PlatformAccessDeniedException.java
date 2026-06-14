package com.workplace.platform.exception;

/**
 * 운영자(플랫폼 역할 미보유) 권한이 없는 사용자가 플랫폼 평면 로그인/접근을 시도 — 403.
 *
 * <p>일반 사용자가 올바른 자격으로 인증되더라도 운영자 평면으로 권한상승하는 것을 차단한다.
 */
public class PlatformAccessDeniedException extends RuntimeException {
  public PlatformAccessDeniedException(String message) {
    super(message);
  }
}
