package com.workplace.issue.dto;

/**
 * AI 에이전트가 반복 회차 결과를 알리는 내부 보고(WP-989). ok 면 message 가 회차 결과(마크다운), 아니면 실패 사유다.
 *
 * @param runId 이벤트 issue.recurring_run 이 실어 보낸 회차 id — 같은 runId 두 번째 보고는 무시한다
 */
public record IssueRecurrenceRunReport(String runId, boolean ok, String message) {}
