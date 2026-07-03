package com.workplace.auth.dto;

import java.util.Map;

/**
 * 멀티 프로바이더(#opencode) provider config — 등록 요청에서 평문으로 받아 컨트롤러가 JSON 직렬화 후 서비스 계층(
 * AiAgentCredentialService)에 전달한다. 형태 검증(providerId/options.baseURL/options.apiKey)은 서비스 계층에서 수행한다.
 */
public record ProviderConfig(String providerId, String npm, Map<String, Object> options) {}
