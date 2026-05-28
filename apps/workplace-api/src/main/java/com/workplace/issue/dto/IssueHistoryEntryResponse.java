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
    Instant createdAt) {}
