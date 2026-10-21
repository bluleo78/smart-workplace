package com.workplace.wiki.dto;

/**
 * 알림을 누른 사람이 어디로 갈지(WP-579 {@code GET /wiki/pages/{id}/entry}) — 멤버면 노트 주소, 공유 대상이면 지금 토큰의 공유 주소.
 *
 * @param spaceId 페이지가 속한 스페이스(노트 주소 {@code /wiki/{spaceId}/{pageId}} 를 만드는 데 쓴다)
 * @param member 이 스페이스의 멤버인가 — true 면 shareToken 은 null
 * @param shareToken 멤버가 아니고 공유 대상일 때 그 페이지를 덮는 공유의 <b>현재</b> 토큰(재발급돼도 최신), 아니면 null
 */
public record WikiPageEntryResponse(long spaceId, boolean member, String shareToken) {}
