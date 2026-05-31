package com.workplace.auth.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

/** 개인 비서 토큰 등록/교체 요청. token 은 Claude OAuth 평문, label 은 선택. */
public record RegisterAssistantTokenRequest(@NotBlank @Size(min = 32) String token, String label) {}
