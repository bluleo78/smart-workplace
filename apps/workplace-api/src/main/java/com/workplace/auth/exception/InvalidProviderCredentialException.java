package com.workplace.auth.exception;

/**
 * 프로바이더 자격증명 등록 요청이 잘못됨 — 허용되지 않은 provider 값, opencode payload JSON 파싱 실패/필드 누락, model 누락 등 → 400.
 */
public class InvalidProviderCredentialException extends RuntimeException {
  public InvalidProviderCredentialException(String message) {
    super(message);
  }
}
