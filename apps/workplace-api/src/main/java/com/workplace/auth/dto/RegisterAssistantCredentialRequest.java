package com.workplace.auth.dto;

import jakarta.validation.Valid;
import jakarta.validation.constraints.Size;

/**
 * 개인 비서 자격증명 등록/교체 요청 — provider 생략 시 anthropic(하위호환 기본). 형태는 {@link
 * ProviderCredentialRegisterRequest} 와 동일(관리자/개인 엔드포인트 분리 컨벤션 유지).
 */
public record RegisterAssistantCredentialRequest(
    String provider,
    @Size(min = 32, max = 2048) String token,
    @Valid ProviderConfig providerConfig,
    // assistant_config.model 에 저장된다 — 폭(64)을 넘으면 409 대신 400(WP-823).
    @Size(max = 64) String model,
    @Size(max = 80) String label,
    // WP-1496: Anthropic 워크스페이스 ID(선택, 모든 Claude 토큰) — 형식 검증은 서비스(AnthropicKeys).
    String workspaceId) {
  /** 토큰·provider config 원문이 로그에 새지 않게 provider·label 만 싣는다. */
  @Override
  public String toString() {
    return "RegisterAssistantCredentialRequest[provider=" + provider + ", label=" + label + "]";
  }
}
