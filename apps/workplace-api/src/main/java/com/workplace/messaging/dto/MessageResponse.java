package com.workplace.messaging.dto;

import java.time.Instant;

/** 메시지 1건. deleted=true 이면 body 는 "(삭제됨)" 으로 마스킹돼 전달된다. authorKind 는 USER.KIND. */
public record MessageResponse(
    Long id,
    Long channelId,
    Long authorId,
    String authorName,
    String authorKind,
    String body,
    Instant createdAt,
    Instant editedAt,
    boolean deleted) {}
