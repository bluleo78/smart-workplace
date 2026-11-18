package com.workplace.wiki.dto;

import java.time.OffsetDateTime;

/**
 * 읽을 수 있는 노트의 카드 필드(WP-1701) — 다른 모듈(calendar)이 노트를 「제목·공간·마지막 고친 사람·때」로만 보일 때 쓴다.
 *
 * @param updatedByName 마지막으로 고친 사람 이름. 고친 사람이 없으면 null
 */
public record WikiPageCard(
    long id,
    String title,
    long spaceId,
    String spaceName,
    String updatedByName,
    OffsetDateTime updatedAt) {}
