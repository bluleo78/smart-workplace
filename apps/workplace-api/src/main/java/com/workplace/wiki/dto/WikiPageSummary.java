package com.workplace.wiki.dto;

import java.time.OffsetDateTime;

public record WikiPageSummary(
    long id,
    Long parentId,
    String title,
    int position,
    // #736: 사이드바 트리 AI 배지 판단용(값 유무만 사용, 액션 종류는 Detail 쪽에만 노출).
    OffsetDateTime aiLastUsedAt) {}
