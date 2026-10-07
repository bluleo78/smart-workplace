package com.workplace.wiki.dto;

import java.time.OffsetDateTime;

/**
 * 노트 AI 요약 응답(WP-301). summaryVersion 은 요약 당시 노트 버전, pageVersion 은 현재 노트 버전 — 웹은 편집기가 들고 있는 최신 버전과
 * summaryVersion 을 비교해 낡음을 즉시 판정한다.
 */
public record WikiPageSummaryState(
    String summary,
    WikiSummaryStatus status,
    Integer summaryVersion,
    int pageVersion,
    OffsetDateTime summarizedAt) {}
