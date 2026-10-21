package com.workplace.wiki.dto;

import java.time.OffsetDateTime;

public record WikiPageSummary(
    long id,
    Long parentId,
    String title,
    int position,
    // #736: 사이드바 트리 AI 배지 판단용(값 유무만 사용, 액션 종류는 Detail 쪽에만 노출).
    OffsetDateTime aiLastUsedAt,
    // WP-579: 이 페이지 자신의 공유(없으면 null) — 사이드바 트리 링크 아이콘과 이동 경고용. 공유 링크로 연 목록에는 싣지 않는다.
    WikiTreeShare share) {}
