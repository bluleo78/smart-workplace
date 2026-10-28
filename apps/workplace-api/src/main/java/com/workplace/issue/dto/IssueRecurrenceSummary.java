package com.workplace.issue.dto;

/**
 * AI 위임 작업 목록 행에 싣는 반복 요약(WP-989) — 행에 「반복」 표시를 그리는 데 필요한 것만.
 *
 * @param time KST 실행 시각 "HH:mm"
 */
public record IssueRecurrenceSummary(String rrule, String time, boolean enabled) {}
