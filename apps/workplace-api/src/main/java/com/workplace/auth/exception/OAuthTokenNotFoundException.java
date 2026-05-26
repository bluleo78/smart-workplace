package com.workplace.auth.exception;

/** Phase 5c-2 후속 (#33): active OAuth 토큰이 없음 → 404. */
public class OAuthTokenNotFoundException extends RuntimeException {
  public OAuthTokenNotFoundException() {
    super("등록된 OAuth 토큰이 없습니다");
  }
}
