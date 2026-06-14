package com.workplace.wiki.dto;

import java.time.OffsetDateTime;

/** 위키 검색 결과 한 건. snippet 은 본문 앞부분 미리보기(전체 본문은 get_wiki_page 로 열람). */
public record WikiSearchResult(
    long id,
    long spaceId,
    String spaceName,
    String title,
    String snippet,
    OffsetDateTime updatedAt) {}
