package com.workplace.wiki.dto;

import java.time.OffsetDateTime;
import java.util.List;

/**
 * 한 페이지의 공유 설정(WP-579) — 웹 {@code WikiPageShare} 와 필드 이름이 같다. token 은 링크 주소에 들어가는 값이라 공유 창이 언제든 다시
 * 복사할 수 있게 그대로 준다(편집자에게만 보이는 응답).
 *
 * @param people audience=PEOPLE 일 때 지정한 사람(그 밖에는 빈 목록)
 * @param expiresAt 만료 시각(null 이면 무기한)
 * @param lastAccessedAt 링크가 마지막으로 열린 시각(없으면 null)
 * @param viewCount 링크로 연 횟수
 */
public record WikiPageShareResponse(
    long pageId,
    String token,
    String audience,
    String permission,
    boolean includeChildren,
    List<WikiSharePerson> people,
    WikiSharePerson createdBy,
    OffsetDateTime createdAt,
    OffsetDateTime updatedAt,
    OffsetDateTime expiresAt,
    OffsetDateTime lastAccessedAt,
    long viewCount) {}
