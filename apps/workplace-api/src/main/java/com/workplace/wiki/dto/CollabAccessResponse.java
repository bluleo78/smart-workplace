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
 */
public record CollabAccessResponse(
    long pageId,
    long spaceId,
    long tenantId,
    long userId,
    String name,
    String role,
    Long tokenExp) {}
