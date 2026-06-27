package com.workplace.issue.outbound.dto;

/** ai-agent /issue/progress-summary 응답. */
public record IssueSummaryResult(String summary, String nextAction) {}
