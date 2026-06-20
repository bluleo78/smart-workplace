package com.workplace.messaging.dto;

import java.util.List;

/** 인박스 페이지(keyset). nextCursor 가 null 이면 마지막. */
public record ThreadInboxPage(List<ThreadInboxItem> items, String nextCursor, boolean hasMore) {}
