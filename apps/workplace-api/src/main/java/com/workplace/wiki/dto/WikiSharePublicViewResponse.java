package com.workplace.wiki.dto;

/**
 * 다른 워크스페이스의 외부(PUBLIC) 링크를 그 워크스페이스 멤버가 아닌 로그인 사용자가 열 때의 409 응답(WP-579). 표준 오류 필드에 받는 화면이 외부 보기로 갈
 * 표시를 더한다. 워크스페이스·페이지 정보는 싣지 않는다.
 *
 * @param code 언제나 {@code WIKI_SHARE_PUBLIC}
 */
public record WikiSharePublicViewResponse(
    int status, String error, String message, String timestamp, String path, String code) {}
