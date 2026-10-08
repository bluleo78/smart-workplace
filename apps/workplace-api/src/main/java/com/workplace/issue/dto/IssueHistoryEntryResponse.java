package com.workplace.issue.dto;

import java.time.Instant;

/** 이슈 히스토리 한 건 응답 DTO. actor 표시 이름 + kind 포함 (USER/AGENT 시각 구분용). */
public record IssueHistoryEntryResponse(
    Long id,
    Long actorId,
    String actorName,
    String actorKind,
    String eventType,
    String fromValue,
    String toValue,
    Instant createdAt,
    // 행위자 username — AI 도구가 표시 이름 대신 이 값으로 사람을 가리킨다(WP-307).
    String actorUsername) {}
