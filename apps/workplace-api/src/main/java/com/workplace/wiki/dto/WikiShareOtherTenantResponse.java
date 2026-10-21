package com.workplace.wiki.dto;

/**
 * 다른 워크스페이스의 공유 링크를 그 워크스페이스 멤버가 열 때의 409 응답(WP-579). 표준 오류 필드에 받는 화면이 워크스페이스를 전환할 값을 더한다.
 *
 * @param code 언제나 {@code WIKI_SHARE_OTHER_TENANT}
 * @param tenantId 링크가 속한 워크스페이스 — 웹이 이 워크스페이스로 전환해 다시 연다
 */
public record WikiShareOtherTenantResponse(
    int status,
    String error,
    String message,
    String timestamp,
    String path,
    String code,
    long tenantId) {}
