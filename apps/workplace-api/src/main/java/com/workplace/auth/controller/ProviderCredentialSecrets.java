package com.workplace.auth.controller;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.workplace.auth.dto.ProviderConfig;
import com.workplace.auth.exception.InvalidProviderCredentialException;

/**
 * provider-credential 등록 컨트롤러(admin/개인) 공용 헬퍼 — provider 기본값 결정과 opencode providerConfig 의 JSON
 * 직렬화(서비스 계층에 평문 문자열로 전달)를 담당한다. 실제 형태 검증(providerId/model 등)은 AiAgentCredentialService 가 수행한다.
 */
final class ProviderCredentialSecrets {

  private ProviderCredentialSecrets() {}

  /** provider 미지정 시 anthropic(하위호환 기본). */
  static String resolveProvider(String provider) {
    return provider != null ? provider : "anthropic";
  }

  /** anthropic 은 token 그대로, opencode 는 providerConfig 를 JSON 직렬화한 문자열을 평문 secret 으로 사용. */
  static String resolveSecret(
      ObjectMapper objectMapper, String provider, String token, ProviderConfig providerConfig) {
    if (!"opencode".equals(provider)) {
      return token;
    }
    try {
      return objectMapper.writeValueAsString(providerConfig);
    } catch (JsonProcessingException e) {
      throw new InvalidProviderCredentialException("providerConfig 직렬화에 실패했습니다");
    }
  }
}
