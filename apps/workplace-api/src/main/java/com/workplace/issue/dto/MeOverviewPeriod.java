package com.workplace.issue.dto;

import com.workplace.issue.metrics.MetricsPeriod;
import java.time.DayOfWeek;
import java.time.LocalDate;
import java.time.temporal.TemporalAdjusters;

/**
 * 「내 작업 · 개요」 기간 고르기(WP-1484) — 화면의 이번 주 / 이번 달 / 최근 3개월. 모두 서울 날짜 기준이며 「오늘」을 끝으로 둔다(아직 오지 않은 날은
 * 칸으로 만들지 않는다).
 *
 * <p>지난 기간 비교는 지표 모듈이 「같은 길이의 바로 앞 기간」으로 한다({@link MetricsPeriod#previous()}) — 달력상 지난달이 아니라서 화면은
 * 「지난 기간」이라고 부른다.
 */
public enum MeOverviewPeriod {
  /** 이번 주 — 이번 주 월요일 ~ 오늘(월요일 시작 주, 지표 모듈 WEEK 칸과 같은 기준). */
  WEEK,
  /** 이번 달 — 이번 달 1일 ~ 오늘. 화면 기본값. */
  MONTH,
  /**
   * 최근 3개월 — 오늘 포함 90일(오늘−89 ~ 오늘). 달력상 3개월(89~92일)은 달마다 길이가 달라 지난 기간 비교가 흔들리므로 고정 90일로 둔다. 「완료일」
   * 필터의 「최근 30일」(오늘 포함 30일)과 같은 셈법이다.
   */
  QUARTER;

  /** 최근 3개월의 일수 — 위 Javadoc 참조. */
  static final int QUARTER_DAYS = 90;

  /** 서울 날짜 today 기준 이 기간의 범위. */
  public MetricsPeriod resolve(LocalDate today) {
    return switch (this) {
      case WEEK ->
          new MetricsPeriod(today.with(TemporalAdjusters.previousOrSame(DayOfWeek.MONDAY)), today);
      case MONTH -> new MetricsPeriod(today.withDayOfMonth(1), today);
      case QUARTER -> new MetricsPeriod(today.minusDays(QUARTER_DAYS - 1L), today);
    };
  }
}
