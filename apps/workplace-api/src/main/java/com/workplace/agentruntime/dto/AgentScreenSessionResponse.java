package com.workplace.agentruntime.dto;

import java.time.OffsetDateTime;

/**
 * 작업 화면 세션을 연 응답(WP-1277). 브라우저는 {@code ticket} 을 실어 {@code GET
 * /api/v1/admin/agent-screen?ticket=…} WebSocket 을 연다 — 브라우저 WebSocket 은 헤더를 실을 수 없어 로그인 토큰 대신 이
 * 일회용 표를 쓴다.
 *
 * @param sessionId 세션 id(UUID 문자열)
 * @param ticket 한 번만 쓸 수 있는 접속 표(30초 안에 써야 한다)
 * @param expiresAt 표가 만료되는 때
 */
public record AgentScreenSessionResponse(
    String sessionId, String ticket, OffsetDateTime expiresAt) {}
