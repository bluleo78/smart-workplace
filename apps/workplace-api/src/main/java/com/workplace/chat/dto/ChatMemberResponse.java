package com.workplace.chat.dto;

import java.time.Instant;

/** Thread 멤버 1명. lastReadMessageId 는 unread 카운트 산출용. */
public record ChatMemberResponse(
    Long userId,
    String username,
    String name,
    String kind,
    Long lastReadMessageId,
    Instant joinedAt) {}
