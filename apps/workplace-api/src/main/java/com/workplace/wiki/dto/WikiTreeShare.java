package com.workplace.wiki.dto;

/**
 * 트리 행에 실리는 공유 요약(WP-579) — 그 페이지 자신의 공유만. 사이드바 링크 아이콘과, 하위 포함 공유의 안팎으로 페이지를 옮길 때의 경고에 쓴다. 토큰·만든
 * 사람은 싣지 않는다(트리는 VIEWER 도 받는다).
 *
 * @param audience WORKSPACE | PEOPLE | PUBLIC
 * @param expired 만료 시각이 지났는지(WP-1043) — 만료된 자기 공유는 위 공유의 상속을 멈추지 않는다(서버 접근 판정과 같게 웹이 이동 경고·아이콘을
 *     판정한다)
 */
public record WikiTreeShare(String audience, boolean includeChildren, boolean expired) {}
