package com.workplace.chat.dto;

import com.workplace.global.dto.MentionResponse;
import java.time.Instant;
import java.util.List;

/** 메시지 1건. deleted=true 이면 body 는 "(삭제됨)" 으로 마스킹돼 전달된다. */
public record ChatMessageResponse(
    Long id,
    Long threadId,
    Long authorId,
    String authorName,
    String authorKind,
    String body,
    List<MentionResponse> mentions,
    Instant createdAt,
    Instant editedAt,
    boolean deleted) {}
