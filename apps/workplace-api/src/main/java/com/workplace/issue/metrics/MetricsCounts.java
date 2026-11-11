package com.workplace.issue.metrics;

/**
 * 기간 하나와 바로 앞 기간의 완료·새로 생김 수만(WP-1478 프로젝트 개요 숫자 카드). {@link IssueMetricsService#forProject} 의
 * {@code current}/{@code previous} 의 {@code completed}·{@code created} 와 같은 값을, 이슈별 사실을 만들지 않고 한
 * 문장으로 센다.
 *
 * @param completed 기간 안에 닫힌 DONE 수(취소 제외)
 * @param previousCompleted 바로 앞 기간의 완료 수
 * @param created 기간 안에 생긴 수(상태 무관)
 * @param previousCreated 바로 앞 기간의 새로 생김 수
 */
public record MetricsCounts(
    int completed, int previousCompleted, int created, int previousCreated) {}
