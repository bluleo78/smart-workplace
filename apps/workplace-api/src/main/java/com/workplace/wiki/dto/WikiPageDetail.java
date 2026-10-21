package com.workplace.wiki.dto;

import java.time.OffsetDateTime;

public record WikiPageDetail(
    long id,
    long spaceId,
    Long parentId,
    String title,
    String body,
    int version,
    Long updatedBy,
    OffsetDateTime updatedAt,
    // #736: 페이지 단위 AI 생성 attribution — 마지막 AI 스트림 사용 시각/액션. 둘 다 null 이면 AI 이력 없음.
    OffsetDateTime aiLastUsedAt,
    String aiLastAction,
    // WP-579: 이 페이지 자신이 링크로 공유 중인지(만료 무관) — 헤더 「공유 중」 표시. 설정 내용은 공유 창을 열 때 따로 받는다.
    boolean shared) {}
