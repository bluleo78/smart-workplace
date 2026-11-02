package com.workplace.issue.dto;

import java.time.Instant;

/**
 * 이슈 반복 응답(WP-989). 시각은 Instant(UTC, ISO "…Z") 로 내린다 — 화면이 KST 로 바꿔 그린다.
 *
 * @param time KST 실행 시각 "HH:mm"
 * @param enabled 꺼져 있으면(3회 연속 실패) 다시 저장(PUT)해야 돈다
 * @param agentName 회차를 실행할 AI 의 이름(없으면 username)
 * @param editable 보는 사람이 이 일정을 고치거나 끌 수 있는지(WP-1314) — 담당 AI 가 남의 개인 비서면 주인만 할 수 있어 false. 「지금 실행」도
 *     같은 규칙이다(WP-1313)
 * @param testRunning 「지금 실행」(테스트 실행, WP-1313)의 결과를 기다리는 중인지 — 화면이 버튼을 「실행 중」으로 잠근다
 */
public record IssueRecurrenceResponse(
    String rrule,
    String time,
    boolean enabled,
    Instant nextRunAt,
    int consecutiveFailures,
    Instant lastRunAt,
    long agentUserId,
    String agentName,
    boolean editable,
    boolean testRunning) {}
