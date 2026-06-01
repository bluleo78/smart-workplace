package com.workplace.messaging.dto;

import java.util.List;

/** 메시지 페이징 응답. cursor 는 base64(createdAt|id). */
public record MessagePage(List<MessageResponse> items, String nextCursor, boolean hasMore) {}
