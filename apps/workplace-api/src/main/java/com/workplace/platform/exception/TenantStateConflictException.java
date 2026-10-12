package com.workplace.platform.exception;

/** 현재 테넌트 상태에서 허용되지 않는 전환(예: 이미 삭제됨, DELETED 아닌데 영구 삭제) — 409. */
public class TenantStateConflictException extends RuntimeException {
  public TenantStateConflictException(String message) {
    super(message);
  }
}
