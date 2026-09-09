package com.workplace.issue.dto;

import java.time.LocalDate;

/**
 * 의존성 응답에 임베드되는 이슈 요약. (Phase 4b) — IssueResponse.blockedBy/blocks 의 원소 타입.
 *
 * <p>{@code dueDate} 는 #669 에서 추가 — 프론트가 blockedBy 선행 이슈의 마감일을 알아야 "선행보다 이른 날짜" 모순을 클라이언트에서 판정할 수
 * 있다(정책: soft 경고, 서버 검증/차단 없음).
 */
public record IssueLinkSummary(
    int number, String title, String status, IssueTypeSummary type, LocalDate dueDate) {}
