package com.workplace.airun.status.dto;

import java.util.List;

/**
 * 처리 이력 한 페이지(WP-1831).
 *
 * @param items 시작 시각 내림차순 항목
 * @param nextCursor 다음 페이지 커서(마지막 페이지면 null)
 */
public record AiRunPage(List<AiRunListItem> items, String nextCursor) {}
