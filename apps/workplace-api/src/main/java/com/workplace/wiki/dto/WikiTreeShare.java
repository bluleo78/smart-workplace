package com.workplace.wiki.dto;

/**
 * 트리 행에 실리는 공유 요약(WP-579) — 그 페이지 자신의 공유만. 사이드바 링크 아이콘과, 하위 포함 공유의 안팎으로 페이지를 옮길 때의 경고에 쓴다. 토큰·만든
 * 사람은 싣지 않는다(트리는 VIEWER 도 받는다).
 *
 * @param audience WORKSPACE | PEOPLE | PUBLIC
 */
public record WikiTreeShare(String audience, boolean includeChildren) {}
