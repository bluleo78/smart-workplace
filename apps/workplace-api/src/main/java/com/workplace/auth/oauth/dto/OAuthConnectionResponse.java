package com.workplace.auth.oauth.dto;

import java.time.OffsetDateTime;

/**
 * 「연결된 앱」 목록 한 줄(WP-1685) — 사용자가 어떤 앱을 어느 워크스페이스에 연결했는지 보고 끊을 수 있게 한다. 모든 워크스페이스의 연결을 함께 돌려준다.
 *
 * @param id 연결 id(끊기 API 의 경로 값)
 * @param clientName 앱 표시 이름
 * @param unverified DCR 로 등록된 앱이면 true(「확인되지 않은 앱」 표시 — 이름은 앱이 스스로 정한 값이다)
 * @param redirectHost 앱의 첫 redirect_uri 호스트 — 같은 이름의 다른 앱을 구별하는 단서
 * @param tenantId 연결된 워크스페이스
 * @param tenantName 연결된 워크스페이스 이름
 * @param createdAt 연결한 시각
 * @param lastUsedAt 마지막으로 쓴 시각(토큰 인증·갱신). 아직 안 썼으면 null
 */
public record OAuthConnectionResponse(
    long id,
    String clientName,
    boolean unverified,
    String redirectHost,
    long tenantId,
    String tenantName,
    OffsetDateTime createdAt,
    OffsetDateTime lastUsedAt) {}
