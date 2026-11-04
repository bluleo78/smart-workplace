package com.workplace.search.dto;

import java.util.List;

/** 통합 검색 AI 대화 일치 한 페이지(WP-1360). hasMore 는 size 보다 한 건 더 읽어 판정한다. */
public record AiConversationPage(List<AiConversationHit> items, boolean hasMore) {}
