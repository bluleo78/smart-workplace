package com.workplace.fileai.outbound;

import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * 워커 서비스 연결 설정. workplace.worker 키로 바인딩.
 *
 * <ul>
 *   <li>baseUrl: 워커 서버 base URL (예: http://localhost:7080)
 *   <li>internalToken: 사내 서비스 인증 — Authorization: Internal {token}
 *   <li>enabled: 전역 on/off. 테스트 기본 false.
 * </ul>
 *
 * @ConfigurationPropertiesScan 이 WorkplaceApplication 에 선언돼 있으므로 별도 @EnableConfigurationProperties
 * 불필요.
 */
@ConfigurationProperties("workplace.worker")
public record WorkerProperties(String baseUrl, String internalToken, boolean enabled) {}
