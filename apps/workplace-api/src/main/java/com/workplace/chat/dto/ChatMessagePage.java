package com.workplace.chat.dto;

import java.util.List;

/** 메시지 페이징 응답. cursor 는 base64(createdAt|id). */
public record ChatMessagePage(
    List<ChatMessageResponse> items, String nextCursor, boolean hasMore) {}
