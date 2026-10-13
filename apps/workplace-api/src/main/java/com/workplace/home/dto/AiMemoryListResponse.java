package com.workplace.home.dto;

import java.util.List;

/** 본인 메모리 목록(WP-55) — updated_at 최신순 전부(최대 limit). limit 은 상한(50)으로 웹 "n / 50" 표시에 쓴다. */
public record AiMemoryListResponse(List<AiMemoryItem> items, int limit) {}
