package com.workplace.issue.dto;

import java.time.Instant;

/** 유형 정의 단건 응답. 관리 페이지에서 사용. */
public record IssueTypeResponse(
    Long id,
    Long projectId,
    String name,
    String colorToken,
    String icon,
    boolean isSystem,
    int position,
    Instant createdAt,
    Instant updatedAt) {}
