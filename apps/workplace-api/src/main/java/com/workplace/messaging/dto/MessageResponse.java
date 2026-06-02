package com.workplace.messaging.dto;

import com.workplace.global.dto.MentionResponse;
import java.time.Instant;
import java.util.List;

/**
 * 메시지 1건. deleted=true 이면 body 는 "(삭제됨)" 으로 마스킹돼 전달된다. authorKind 는 USER.KIND. mentions 는 본문에서 멘션된
 * 사용자(존재하는 user 만 hydrate).
 */
public record MessageResponse(
    Long id,
    Long channelId,
    Long authorId,
    String authorName,
    String authorKind,
    String body,
    List<MentionResponse> mentions,
    Instant createdAt,
    Instant editedAt,
    boolean deleted) {}
