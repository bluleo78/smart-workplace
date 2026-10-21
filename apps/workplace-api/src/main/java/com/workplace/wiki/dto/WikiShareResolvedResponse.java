package com.workplace.wiki.dto;

import java.util.List;

/**
 * 공유 링크 열기 응답(WP-579) — 웹 {@code WikiShareResolved} 와 같은 모양.
 *
 * @param rootPageId 공유한 페이지
 * @param permission VIEW | EDIT
 * @param sharedBy 공유를 만든 사람
 * @param member 연 사람의 스페이스 멤버 역할이 공유 역할 이상이면 true — 웹이 원래 노트 화면으로 보낸다
 * @param pages 링크로 볼 수 있는 페이지(하위 포함이면 지금 서브트리, 아니면 루트 하나). 루트의 parentId 는 범위 밖이라 null
 */
public record WikiShareResolvedResponse(
    long rootPageId,
    long spaceId,
    String permission,
    boolean includeChildren,
    WikiSharePerson sharedBy,
    boolean member,
    List<WikiPageSummary> pages) {}
