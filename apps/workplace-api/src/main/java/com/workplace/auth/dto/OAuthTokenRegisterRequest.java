package com.workplace.auth.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

/**
 * OAuth 토큰 등록 요청 — 평문 token (32~2048 chars) + 선택 label (≤80). 길이 검증만 (Anthropic 토큰 형식은 변할 수 있어
 * prefix 검증은 안 한다).
 */
public record OAuthTokenRegisterRequest(
    @NotBlank @Size(min = 32, max = 2048) String token, @Size(max = 80) String label) {}
