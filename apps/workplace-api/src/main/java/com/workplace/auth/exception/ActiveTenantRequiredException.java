package com.workplace.auth.exception;

/** PAT 발급은 활성 테넌트(TenantContext)가 선택된 세션에서만 가능하다 — 미선택 시 400. */
public class ActiveTenantRequiredException extends RuntimeException {
  public ActiveTenantRequiredException() {
    super("PAT 를 발급하려면 활성 테넌트를 먼저 선택해야 합니다");
  }
}
