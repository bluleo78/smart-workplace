package com.workplace.search.dto;

import java.time.Instant;
import java.util.UUID;

/**
 * 통합 검색 「AI 대화」 한 건(WP-1360) — 대화(세션) 하나. role 은 맞은 메시지의 역할("USER"=질문, "ASSISTANT"=답)이고 excerpt 는 그
 * 메시지의 발췌다.
 */
public record AiConversationHit(
    UUID sessionId, String title, Instant lastMessageAt, String role, String excerpt) {}
