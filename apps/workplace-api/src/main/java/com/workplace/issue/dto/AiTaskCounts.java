package com.workplace.issue.dto;

/**
 * AI 위임 작업 화면 빠른 필터 칩 건수(WP-377) — 전체·답변 필요(INPUT_REQUIRED)·검토 필요·막힘(BLOCKED+AUTH_REQUIRED)·작업 중.
 * SUBMITTED·PAUSED 는 칩이 없고 전체에만 든다. 범위·이슈 상태·우선순위 필터는 목록과 같고, AI 진행 상태 필터·커서는 무시한다(칩 자체가 상태 필터이므로).
 */
public record AiTaskCounts(long all, long inputRequired, long review, long blocked, long working) {}
