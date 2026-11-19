package com.workplace.wiki.dto;

import java.time.OffsetDateTime;
import java.util.List;

/**
 * 노트 「최근」 한 줄(WP-1764).
 *
 * @param ancestorTitles 공간 루트 → 부모 순 조상 제목. 루트 직속이면 빈 목록
 * @param lastAction OPEN | EDIT
 * @param url 노트 화면 주소(AppWebLinks)
 */
public record WikiRecentPageItem(
    long pageId,
    String title,
    long spaceId,
    String spaceName,
    List<String> ancestorTitles,
    String lastAction,
    OffsetDateTime lastAt,
    String url) {}
