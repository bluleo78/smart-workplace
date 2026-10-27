package com.workplace.issue.dto;

/**
 * AI 위임 작업 화면 빠른 필터 칩 건수(WP-377) — 미완료(all: 진행 중 작업이 있는 이슈)·답변 필요(INPUT_REQUIRED)·검토 필요·막힘
 * (BLOCKED+AUTH_REQUIRED)·작업 중·대기 중(WAITING, WP-1024)·다음 회차 대기(SCHEDULED, WP-450)·완료(done: 진행 중 작업
 * 없이 종료 작업만 있는 이슈, WP-396). SUBMITTED·PAUSED 는 칩이 없고 미완료에만 든다. all 은 옛 「전체」 칩 필드명을 호환으로 유지한다. 범위·이슈
 * 상태·우선순위 필터는 목록과 같고, AI 진행 상태 필터·커서는 무시한다(칩 자체가 상태 필터이므로).
 */
public record AiTaskCounts(
    long all,
    long inputRequired,
    long review,
    long blocked,
    long working,
    long waiting,
    long scheduled,
    long done) {}
