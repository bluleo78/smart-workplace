package com.workplace.home.dto;

import java.util.List;

/**
 * 기록 한 묶음(WP-385) — nextCursor 가 null 이면 끝. count30d 는 지난 30일 기록 수(되돌린 것 포함 — 안내 줄의 「n번」, 0 이면 웹이
 * 안내 줄을 숨긴다).
 */
public record AiMemoryChangePage(List<AiMemoryChangeItem> items, String nextCursor, int count30d) {}
