package com.workplace.platform.exception;

/** 이미 해당 테넌트의 ACTIVE 멤버인 사용자를 "기존 사용자 추가" 흐름으로 다시 추가하려는 시도 — 409. */
public class TenantMemberAlreadyExistsException extends RuntimeException {
  public TenantMemberAlreadyExistsException(String message) {
    super(message);
  }
}
