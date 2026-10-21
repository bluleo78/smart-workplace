package com.workplace.wiki.dto;

import java.time.OffsetDateTime;

/**
 * 공유 목록 한 줄(WP-579) — 스페이스 「공유 중인 페이지」·내 공유·관리자 전체 목록이 함께 쓴다. 웹 {@code WikiShareListItem}(= {@code
 * WikiSharedPageItem} + 스페이스·토큰)과 필드 이름이 같다.
 *
 * @param peopleCount 지정한 사람 수(PEOPLE 이 아니면 0)
 * @param createdBy 공유한 사람
 * @param expiresAt 만료 시각(null 이면 무기한)
 * @param lastAccessedAt 링크가 마지막으로 열린 시각(없으면 null)
 * @param token 링크 토큰 — 스페이스 목록은 EDITOR 미만 호출자에게 null(보기 권한만 있는 멤버가 편집 링크 토큰을 읽어 스스로 권한을 얻지 못하게). 내
 *     공유·관리자 목록은 항상 값이 있다
 */
public record WikiShareListItemResponse(
    long pageId,
    String title,
    String audience,
    String permission,
    boolean includeChildren,
    int peopleCount,
    WikiSharePerson createdBy,
    OffsetDateTime updatedAt,
    OffsetDateTime expiresAt,
    OffsetDateTime lastAccessedAt,
    long viewCount,
    long spaceId,
    String spaceName,
    String token) {

  /** 토큰만 가린 사본 — EDITOR 미만 호출자에게 스페이스 목록을 줄 때. */
  public WikiShareListItemResponse withoutToken() {
    return new WikiShareListItemResponse(
        pageId,
        title,
        audience,
        permission,
        includeChildren,
        peopleCount,
        createdBy,
        updatedAt,
        expiresAt,
        lastAccessedAt,
        viewCount,
        spaceId,
        spaceName,
        null);
  }
}
