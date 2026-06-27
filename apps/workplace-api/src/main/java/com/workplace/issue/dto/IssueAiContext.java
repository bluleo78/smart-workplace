package com.workplace.issue.dto;

import java.time.Instant;
import java.util.List;

/**
 * 이슈 Instant Context 카드 페이로드. summary 는 저장본(없으면 null), blockers 는 읽기 시 결정적으로 계산.
 *
 * <p>저장 요약도 없고 블로커도 없으면 IssueDetailResponse.aiContext() 자체가 null 이므로 이 레코드가 인스턴스화되는 시점에는 반드시 하나 이상의
 * 필드가 유효하다.
 */
public record IssueAiContext(
    /** AI 생성 요약 문자열 (없으면 null). */
    String summary,
    /** AI 추천 다음 행동 (없으면 null). */
    String nextAction,
    /** 요약 생성 시각 UTC (없으면 null). */
    Instant generatedAt,
    /** 결정적으로 계산된 블로커 배지 목록 (없으면 빈 리스트). */
    List<IssueBlockerBadge> blockers) {}
