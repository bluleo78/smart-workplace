package com.workplace.issue.dto;

import java.time.Instant;
import java.util.List;

/**
 * 이슈 Instant Context 카드 페이로드. summary 는 저장본(없으면 null), blockers 는 읽기 시 결정적으로 계산.
 *
 * <p>IssueDetailResponse.aiContext() 는 항상 non-null — 온디맨드 생성 버튼을 항상 노출하기 위해 저장본·블로커 여부와 무관하게
 * 인스턴스화한다. summary/nextAction/generatedAt 은 저장본이 없으면 null.
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
