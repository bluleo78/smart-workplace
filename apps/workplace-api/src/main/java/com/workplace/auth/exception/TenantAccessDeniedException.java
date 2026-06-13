package com.workplace.auth.exception;

/** 비멤버이거나 정지(SUSPENDED)된 테넌트 선택 시 — 403. */
public class TenantAccessDeniedException extends RuntimeException {
  public TenantAccessDeniedException(String message) {
    super(message);
  }
}
