package com.workplace.issue.dto;

/** 이슈 응답에 임베드되는 유형 요약 (배지/아이콘 렌더링용 최소 필드). */
public record IssueTypeSummary(Long id, String name, String colorToken, String icon) {}
