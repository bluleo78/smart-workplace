package com.workplace.home.dto;

import com.fasterxml.jackson.annotation.JsonInclude;
import java.time.Instant;

/**
 * AI 메모리 1건(WP-55). previousContent 는 고치기 응답에만(그 외 null → JSON 에서 빠짐) — ai-agent update_memory 결과와
 * 채팅 되돌리기 근거가 된다.
 */
public record AiMemoryItem(
    long id,
    String kind,
    String content,
    String source,
    Instant createdAt,
    Instant updatedAt,
    @JsonInclude(JsonInclude.Include.NON_NULL) String previousContent) {}
