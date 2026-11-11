package com.workplace.auth.exception;

import java.util.Map;

/**
 * 프로바이더 자격증명 등록 요청이 잘못됨 — 허용되지 않은 provider 값, opencode payload JSON 파싱 실패/필드 누락, model 누락 등 → 400.
 *
 * <p>errors(WP-1496)는 화면이 특정 입력 칸에 안내를 붙일 때 싣는 필드별 오류(예: {@code workspaceId} — 워크스페이스 ID 가 필요한
 * Anthropic 키). 없으면 null 이고 응답의 errors 도 비운다.
 */
public class InvalidProviderCredentialException extends RuntimeException {

  /** 필드별 오류(필드 이름 → 안내) — 없으면 null. */
  private final Map<String, String> errors;

  public InvalidProviderCredentialException(String message) {
    this(message, null);
  }

  /** 필드별 오류를 함께 싣는 400 — 응답 ErrorResponse.errors 로 그대로 나간다. */
  public InvalidProviderCredentialException(String message, Map<String, String> errors) {
    super(message);
    this.errors = errors == null ? null : Map.copyOf(errors);
  }

  /** 필드별 오류 — 없으면 null. */
  public Map<String, String> getErrors() {
    return errors;
  }
}
