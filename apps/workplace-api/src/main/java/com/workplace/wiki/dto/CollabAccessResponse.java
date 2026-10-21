package com.workplace.wiki.dto;

/**
 * 동기화 서버 연결 시 권한 판정 결과(WP-286).
 *
 * @param pageId 페이지
 * @param spaceId 페이지가 속한 공간
 * @param tenantId 호출자의 활성 테넌트 — 동기화 서버가 이후 내부 호출의 X-Tenant-Id 로 쓴다
 * @param userId 호출자
 * @param name 호출자 표시 이름(커서·접속자 표시용)
 * @param role 공간 역할(OWNER/EDITOR/VIEWER) — VIEWER 면 동기화 서버가 읽기 전용 연결로 둔다
 * @param tokenExp JWT 로 인증된 요청이면 그 토큰의 exp(epoch 초), 아니면 null(키는 항상 존재). 동기화 서버가 연결 만료에 쓴다
 * @param shareExpiresAt 역할을 공유 링크(WP-579)가 정했을 때 그 공유의 만료 시각(epoch <b>밀리초</b>), 아니면 null(키는 항상 존재).
 *     동기화 서버가 공유로 붙은 연결을 이 시각에 다시 판정해 닫는다(만료 = 즉시 막힘). 초로 내리면 실제 만료보다 먼저 판정해 아직 열린 것으로 보므로 밀리초다
 */
public record CollabAccessResponse(
    long pageId,
    long spaceId,
    long tenantId,
    long userId,
    String name,
    String role,
    Long tokenExp,
    Long shareExpiresAt) {}
