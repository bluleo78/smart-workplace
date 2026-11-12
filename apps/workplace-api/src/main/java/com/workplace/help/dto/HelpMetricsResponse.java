package com.workplace.help.dto;

import java.util.List;

/**
 * 도움말 지표 조회 응답(WP-1512).
 *
 * @param kind 조회한 지표 종류
 * @param days 집계 기간(일)
 * @param items 상위 목록(건수 내림차순, 최대 100건)
 */
public record HelpMetricsResponse(HelpMetricKind kind, int days, List<HelpMetricRow> items) {}
