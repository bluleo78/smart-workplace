package com.workplace.auth.exception;

/** Task10 — 모델 프로브 baseURL 이 https 도 아니고 사설망 http 도 아님(SSRF 최소화) → 400. */
public class UnsafeProbeUrlException extends RuntimeException {
  public UnsafeProbeUrlException(String message) {
    super(message);
  }
}
