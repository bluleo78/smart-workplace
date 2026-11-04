package com.workplace.search.dto;

import java.util.List;

/**
 * 통합 검색 메시지 일치 한 페이지(WP-1358). hasMore 는 size 보다 한 건 더 읽어 판정하고, 다음 쪽은 마지막 행의 (createdAt, id) 로 이어
 * 받는다.
 */
public record MessageSearchPage(List<MessageSearchHit> items, boolean hasMore) {}
