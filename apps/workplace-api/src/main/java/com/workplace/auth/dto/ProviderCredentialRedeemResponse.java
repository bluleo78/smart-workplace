package com.workplace.auth.dto;

/**
 * AGENT 본인의 GET /users/me/provider-credential 응답 — 평문 자격증명 포함. provider='anthropic' 이면 token
 * 채움(payload=null), provider='opencode' 이면 payload(복호화된 provider config JSON) 채움(token=null). model
 * 은 assistant_config.model(없으면 null). 본 응답은 ai-agent 측에서만 소비되며 절대 사용자 UI 로 노출되지 않는다.
 */
public record ProviderCredentialRedeemResponse(
    String provider, String token, String payload, String model, String label) {}
