package com.workplace.airun.status.dto;

import java.time.Instant;
import java.util.UUID;

/**
 * 처리 이력 한 건 상세(WP-1831) — 목록 항목에 캐시 토큰·자격 증명·시도 횟수·원본 시각·실패 상세를 더한다. AI 처리(ai_run)만 상세가 있다.
 *
 * @param item 목록 항목
 * @param runId 처리 ID
 * @param cacheReadTokens 캐시 읽기 토큰
 * @param cacheWriteTokens 캐시 쓰기 토큰
 * @param credentialLabel 사용한 자격 증명 표시 이름
 * @param attempt 시도 횟수
 * @param sourceAt 처리를 일으킨 원본 시각
 * @param errorDetail 실패 상세
 */
public record AiRunDetail(
    AiRunListItem item,
    UUID runId,
    Long cacheReadTokens,
    Long cacheWriteTokens,
    String credentialLabel,
    Integer attempt,
    Instant sourceAt,
    String errorDetail) {}
