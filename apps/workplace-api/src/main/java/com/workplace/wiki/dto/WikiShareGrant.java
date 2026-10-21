package com.workplace.wiki.dto;

import java.time.OffsetDateTime;

/**
 * 공유 링크(토큰)로 이 페이지에 주어진 권한(WP-579). {@link com.workplace.wiki.service.WikiShareAccess#grant} 의 결과.
 *
 * @param shareId 판정에 쓰인 공유 행 id
 * @param rootPageId 공유한 페이지(하위 포함이면 그 하위의 꼭대기)
 * @param includeChildren 하위 포함 공유인지 — 멘션 가림이 범위 안 페이지를 고를 때 공유 행을 다시 읽지 않게 함께 싣는다
 * @param role 공유가 주는 역할 — VIEWER | EDITOR(외부 공개는 언제나 VIEWER)
 * @param createdBy 공유를 만든 사람 — 받는 화면의 「○○님이 공유」와 접근 요청 알림 대상
 * @param expiresAt 공유 만료 시각(null = 무기한) — 이 권한이 끝나는 때. 동기화 서버가 공유로 붙은 연결을 이 시각에 다시 판정한다
 */
public record WikiShareGrant(
    long shareId,
    long rootPageId,
    boolean includeChildren,
    String role,
    long createdBy,
    OffsetDateTime expiresAt) {}
