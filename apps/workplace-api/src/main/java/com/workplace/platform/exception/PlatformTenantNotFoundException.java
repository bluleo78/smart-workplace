package com.workplace.platform.exception;

/** 운영자 콘솔에서 존재하지 않는 테넌트 id 로 상세/정지/활성화/멤버 조회를 시도한 경우. GlobalExceptionHandler 에서 404 로 매핑한다. */
public class PlatformTenantNotFoundException extends RuntimeException {
  public PlatformTenantNotFoundException(String message) {
    super(message);
  }
}
