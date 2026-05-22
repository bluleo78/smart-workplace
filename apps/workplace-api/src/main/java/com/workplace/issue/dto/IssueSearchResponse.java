package com.workplace.issue.dto;

import java.util.List;

/** 검색 결과 페이지. cursor 페이지네이션 결과. */
public record IssueSearchResponse(List<IssueResponse> items, String nextCursor, boolean hasMore) {}
