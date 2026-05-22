package com.workplace.issue.dto;

import java.util.List;

/** 이슈 상세 응답 DTO: 요약 + 본문 + 코멘트 + 히스토리. */
public record IssueDetailResponse(
    IssueResponse summary,
    String body,
    List<IssueCommentResponse> comments,
    List<IssueHistoryEntryResponse> history) {}
