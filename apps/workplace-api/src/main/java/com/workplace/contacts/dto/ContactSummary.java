package com.workplace.contacts.dto;

/**
 * 통합 목록 항목. isFavorite 는 호출자(callerId) 기준 즐겨찾기 여부.
 *
 * @param username MEMBER 항목의 로그인 아이디(사람을 가리키는 식별자 — MCP 도구가 숫자 id 대신 내보낸다, WP-353). EXTERNAL 은 null
 */
public record ContactSummary(
    String type,
    long id,
    String username,
    String name,
    String email,
    String title,
    String organization,
    boolean isFavorite) {}
