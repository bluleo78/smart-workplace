package com.workplace.issue.metrics;

import java.util.List;

/**
 * 성과 지표 계산 결과(WP-1476) — {@link IssueMetricsService} 의 반환값.
 *
 * @param period 현재 기간
 * @param previousPeriod 같은 길이의 바로 앞 기간
 * @param granularity 칸 묶음 단위
 * @param current 현재 기간 요약
 * @param previous 지난 기간 요약(칸 없음)
 * @param buckets 현재 기간 칸 목록(시간순, 빈 칸 0)
 * @param closedIssues 현재 기간 완료 이슈 사실 목록(닫힌 시각 내림차순)
 */
public record IssueMetrics(
    MetricsPeriod period,
    MetricsPeriod previousPeriod,
    MetricsGranularity granularity,
    MetricsSummary current,
    MetricsSummary previous,
    List<MetricsBucket> buckets,
    List<ClosedIssueFact> closedIssues) {}
