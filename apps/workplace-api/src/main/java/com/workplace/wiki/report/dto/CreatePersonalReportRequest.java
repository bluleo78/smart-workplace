package com.workplace.wiki.report.dto;

import java.time.LocalDate;

/**
 * 「보고서 만들기」 요청(WP-1486). 종류에 맞는 기간 값 하나만 쓴다 — 일일 {@code date}, 주간 {@code weekStart}(월요일), 월간 {@code
 * month}(「2026-10」). 빠지거나 틀리면 400.
 *
 * @param kind DAILY / WEEKLY / MONTHLY
 * @param force true 면 같은 회차 보고가 있어도 「새로 만들기」(제목 「(2)」)
 */
public record CreatePersonalReportRequest(
    String kind, LocalDate date, LocalDate weekStart, String month, Boolean force) {}
