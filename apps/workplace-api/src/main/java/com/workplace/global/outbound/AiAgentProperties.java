package com.workplace.global.outbound;

import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * ai-agent 발사 설정. workplace.ai-agent 키로 바인딩.
 *
 * <ul>
 *   <li>baseUrl: ai-agent 서버 base URL (예: http://localhost:7070)
 *   <li>internalToken: 사내 서비스 인증 — Authorization: Internal {token}
 *   <li>enabled: 전역 on/off. 테스트 기본 false.
 * </ul>
 */
@ConfigurationProperties("workplace.ai-agent")
public record AiAgentProperties(String baseUrl, String internalToken, boolean enabled) {}
