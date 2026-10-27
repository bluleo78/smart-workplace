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
    WikiTreeShare share,
    // WP-1031: 이 페이지에 상위 공유 제외 표시(WP-987)가 있는지 — 이동 경고가 「새 위치의 공유 링크로 보이게 된다」고 잘못 말하지 않게.
    // 공유 링크로 연 목록에는 늘 false.
    boolean shareExcluded) {}
