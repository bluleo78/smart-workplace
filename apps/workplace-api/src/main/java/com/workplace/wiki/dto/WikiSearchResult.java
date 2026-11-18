package com.workplace.wiki.dto;

import java.time.OffsetDateTime;

/**
 * 위키 검색 결과 한 건. snippet 은 본문 앞부분 미리보기(전체 본문은 get_wiki_page 로 열람). updatedByName 은 마지막으로 고친 사람
 * 이름(없으면 null, WP-1701).
 */
public record WikiSearchResult(
    long id,
    long spaceId,
    String spaceName,
    String title,
    String snippet,
    OffsetDateTime updatedAt,
    String updatedByName) {}
