package com.workplace.auth.dto;

import jakarta.validation.Valid;
import jakarta.validation.constraints.Size;

/**
 * provider-credential 등록 요청(관리자) — provider 생략 시 anthropic(하위호환 기본). anthropic: token 필수, opencode:
 * providerConfig+model 필수 — 두 경우 모두 서비스 계층(AiAgentCredentialService)에서 검증한다. providerConfig 는 컨트롤러가
 * JSON 직렬화해 평문 문자열로 서비스에 전달한다.
 */
public record ProviderCredentialRegisterRequest(
    String provider,
    @Size(min = 32, max = 2048) String token,
    @Valid ProviderConfig providerConfig,
    String model,
    @Size(max = 80) String label) {}
