package com.workplace.wiki.outbound;

import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * 노트 동기화 서버(workplace-collab) 연동 설정 — {@code workplace.collab} 키로 바인딩(WP-286).
 *
 * <ul>
 *   <li>baseUrl: 동기화 서버 base URL
 *   <li>internalToken: 서비스 간 인증 토큰 — 동기화 서버가 {@code Authorization: Internal <token>} 으로 내부 엔드포인트를
 *       호출할 때 검증한다(양방향 호출 공용)
 *   <li>enabled: 전역 on/off. 테스트 기본 false
 * </ul>
 *
 * <p>{@code @ConfigurationPropertiesScan} 이 WorkplaceApplication 에 있어 별도 등록 불필요.
 */
@ConfigurationProperties(prefix = "workplace.collab")
public record CollabProperties(String baseUrl, String internalToken, boolean enabled) {}
