package com.workplace.drive.dto;

import java.time.OffsetDateTime;

/**
 * 링크 목록 항목이자 생성 응답(WP-1528 — 생성 직후에도 목록과 같은 모양으로 돌려줘 웹이 서버 행을 그대로 맨 위에 넣는다). active 는 서버가 자기 시계로
 * 판정한 「지금 쓸 수 있음」(폐기되지 않았고 만료 전) — 웹은 살아 있는/지난 링크를 이 값으로 나눈다(브라우저 시계에 맡기지 않음). token 은 서버에 암호문으로
 * 저장된 평문 토큰을 복호화한 값 — 파일 EDITOR 이상에게만 목록으로 내려간다. 살아 있는 링크만 담고, 폐기·만료된 링크, WP-1528 이전 링크, 복호화 실패·해시
 * 불일치면 null(다시 복사 불가). 해시는 노출하지 않는다.
 */
public record ShareLinkResponse(
    long id,
    String audience,
    boolean hasPassword,
    OffsetDateTime expiresAt,
    boolean revoked,
    boolean active,
    OffsetDateTime createdAt,
    long createdBy,
    String createdByName,
    String token) {}
