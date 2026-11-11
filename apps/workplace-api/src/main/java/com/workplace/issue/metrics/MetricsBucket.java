package com.workplace.issue.metrics;

import java.time.LocalDate;

/**
 * 현재 기간 추이 그래프의 한 칸(WP-1476). 일이 없는 칸도 0 으로 채워 빠짐없이 내려준다 — 화면이 칸 사이를 보간하지 않게.
 *
 * @param start 칸 첫날(서울, 포함). 기간 경계에서 잘린 칸이면 기간 시작일
 * @param end 칸 마지막 날(서울, 포함). 기간 경계에서 잘린 칸이면 기간 종료일
 * @param completed 이 칸에 닫힌 완료 수
 * @param overdue 그중 마감 초과 수
 * @param created 이 칸에 새로 생긴 수
 */
public record MetricsBucket(
    LocalDate start, LocalDate end, int completed, int overdue, int created) {}
