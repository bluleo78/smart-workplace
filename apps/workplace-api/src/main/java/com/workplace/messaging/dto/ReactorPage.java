package com.workplace.messaging.dto;

import java.util.List;

/** 반응자 페이지(keyset). nextCursor 가 null 이면 마지막. 정렬 = 먼저 누른 사람부터. */
public record ReactorPage(List<ReactorResponse> items, String nextCursor, boolean hasMore) {}
