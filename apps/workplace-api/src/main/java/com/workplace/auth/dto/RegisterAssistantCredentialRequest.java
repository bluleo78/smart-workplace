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
    String model,
    @Size(max = 80) String label) {}
