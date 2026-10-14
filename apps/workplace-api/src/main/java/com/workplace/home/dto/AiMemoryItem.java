package com.workplace.home.dto;

import com.fasterxml.jackson.annotation.JsonInclude;
import java.time.Instant;

/**
 * AI 메모리 1건(WP-55). previousContent·previousKind 는 고치기 응답에만(그 외 null → JSON 에서 빠짐) — ai-agent
 * update_memory 결과와 채팅 되돌리기 근거가 된다(previousKind 가 있어야 AI 가 종류까지 바꾼 고침을 종류째 되돌린다).
 *
 * <p>WP-379: scope 는 항상 싣는다(null = 공통). previousScope 는 고치기 응답에서 이전 범위가 앱일 때만 실린다 — 없으면 공통(구 블록과 같은
 * 해석, 판정 18).
 */
public record AiMemoryItem(
    long id,
    String kind,
    String content,
    String source,
    Instant createdAt,
    Instant updatedAt,
    @JsonInclude(JsonInclude.Include.NON_NULL) String previousContent,
    @JsonInclude(JsonInclude.Include.NON_NULL) String previousKind,
    String scope,
    @JsonInclude(JsonInclude.Include.NON_NULL) String previousScope) {}
