package com.workplace.chat.dto;

import java.time.Instant;
import java.util.List;

/** Thread getter 응답. 멤버 + 최근 메시지 동봉. */
public record ChatThreadResponse(
    Long threadId,
    Long issueId,
    Instant archivedAt,
    List<ChatMemberResponse> members,
    List<ChatMessageResponse> recentMessages) {}
