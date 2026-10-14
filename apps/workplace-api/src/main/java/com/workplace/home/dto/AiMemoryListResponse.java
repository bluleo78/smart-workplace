package com.workplace.home.dto;

import java.util.List;

/**
 * 본인 메모리 목록(WP-55) — updated_at 최신순. limit 은 범위마다 상한(300, 웹 "n / 300"), pinLimit 은 범위마다 고정 상한(10,
 * WP-383 — 웹이 고정 토글을 막는 기준).
 */
public record AiMemoryListResponse(List<AiMemoryItem> items, int limit, int pinLimit) {}
