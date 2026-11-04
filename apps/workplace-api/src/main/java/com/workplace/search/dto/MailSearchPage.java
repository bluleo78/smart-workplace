package com.workplace.search.dto;

import java.util.List;

/** 통합 검색 메일 한 페이지(WP-1359). hasMore 는 size 보다 한 건 더 읽어 판정한다 — 다음 쪽 커서는 마지막 항목의 (receivedAt, id). */
public record MailSearchPage(List<MailSearchHit> items, boolean hasMore) {}
