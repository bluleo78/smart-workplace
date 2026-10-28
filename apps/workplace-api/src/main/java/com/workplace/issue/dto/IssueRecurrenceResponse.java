package com.workplace.issue.dto;

import java.time.Instant;

/**
 * 이슈 반복 응답(WP-989). 시각은 Instant(UTC, ISO "…Z") 로 내린다 — 화면이 KST 로 바꿔 그린다.
 *
 * @param time KST 실행 시각 "HH:mm"
 * @param enabled 꺼져 있으면(3회 연속 실패) 다시 저장(PUT)해야 돈다
 * @param agentName 회차를 실행할 AI 의 이름(없으면 username)
 */
public record IssueRecurrenceResponse(
    String rrule,
    String time,
    boolean enabled,
    Instant nextRunAt,
    int consecutiveFailures,
    Instant lastRunAt,
    long agentUserId,
    String agentName) {}
