package com.workplace.wiki.dto;

/**
 * 로그인하지 않은 사람이 내부(WORKSPACE·PEOPLE) 공유 링크를 외부 보기로 열 때의 401 응답(WP-579). 표준 오류 응답 필드에 받는 화면이 로그인 화면으로
 * 보낼 표시를 더한다. 페이지·사람·워크스페이스 정보는 싣지 않는다.
 *
 * @param loginRequired 로그인하면 열릴 수 있는 링크 — 언제나 true
 */
public record WikiShareLoginRequiredResponse(
    int status,
    String error,
    String message,
    String timestamp,
    String path,
    boolean loginRequired) {}
