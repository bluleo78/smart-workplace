package com.workplace.issue.dto;

import java.time.Instant;

/** 이슈 코멘트 응답 DTO. 작성자 표시 이름 + kind 포함 (USER/AGENT 시각 구분용). */
public record IssueCommentResponse(
    Long id,
    Long issueId,
    Long authorId,
    String authorName,
    String authorKind,
    String body,
    Instant createdAt,
    Instant updatedAt) {}
