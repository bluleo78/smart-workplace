package com.workplace.home.dto;

import java.time.Instant;

/** 활동 피드 1건 — 이슈 컨텍스트 + 행위자 + 이벤트. */
public record ActivityEntryResponse(
    Long id,
    Long issueId,
    String projectKey,
    Integer issueNumber,
    String issueTitle,
    Long actorId,
    String actorName,
    String actorKind,
    String eventType,
    Instant createdAt) {}
