package com.workplace.issue.dto;

import java.time.Instant;

/**
 * issue_ai_summary 한 행의 읽기 전용 뷰. 블로커 배지는 읽기 시 결정적으로 계산하므로 여기 포함하지 않는다.
 *
 * @param issueId 이슈 PK
 * @param summary AI 생성 요약 문자열
 * @param nextAction AI 추천 다음 행동(없으면 null)
 * @param generatedAt 생성 시각(UTC)
 */
public record IssueAiSummaryRecord(
    long issueId, String summary, String nextAction, Instant generatedAt) {}
