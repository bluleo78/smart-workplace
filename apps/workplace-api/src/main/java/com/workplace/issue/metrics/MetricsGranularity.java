package com.workplace.issue.metrics;

/**
 * 성과 지표 칸 묶음 단위(WP-1476). 모두 서울 날짜 기준이다.
 *
 * <ul>
 *   <li>{@link #DAY} — 서울 하루
 *   <li>{@link #WEEK} — 월요일 시작 주. 기간 경계에서 잘린 첫·마지막 칸은 기간 안 부분만
 *   <li>{@link #MONTH} — 달력 월. 기간 경계에서 잘린 칸은 기간 안 부분만
 * </ul>
 */
public enum MetricsGranularity {
  DAY,
  WEEK,
  MONTH
}
