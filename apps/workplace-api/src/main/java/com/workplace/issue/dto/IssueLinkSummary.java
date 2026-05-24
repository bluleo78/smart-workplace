package com.workplace.issue.dto;

/** 의존성 응답에 임베드되는 이슈 요약. (Phase 4b) — IssueResponse.blockedBy/blocks 의 원소 타입. */
public record IssueLinkSummary(int number, String title, String status, IssueTypeSummary type) {}
