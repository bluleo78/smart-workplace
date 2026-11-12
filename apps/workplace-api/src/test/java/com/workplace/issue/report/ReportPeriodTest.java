package com.workplace.issue.report;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.LocalDate;
import java.time.OffsetDateTime;
import org.junit.jupiter.api.Test;

/**
 * 리포트 회차(WP-1483) — 실행 시각 전에 끝난 가장 최근 완전 회차, 주차 규칙(일요일의 달·1일이 든 주가 1주차), 제목·기간 표기, 바로 앞 회차를 고정한다.
 * 순수 단위 테스트.
 */
class ReportPeriodTest {

  private static LocalDate d(String iso) {
    return LocalDate.parse(iso);
  }

  private static OffsetDateTime kst(String localDateTime) {
    return OffsetDateTime.parse(localDateTime + "+09:00");
  }

  @Test
  void weekOfMonth_matchesMockups() {
    // 시안 「10월 20~26일 = 10월 4주차」, 「11월 3~9일 = 11월 2주차」, 달을 걸친 주(10/27~11/2)는 11월 1주차.
    assertThat(ReportPeriod.weekOfMonth(d("2025-10-26"))).isEqualTo(4);
    assertThat(ReportPeriod.weekOfMonth(d("2025-11-09"))).isEqualTo(2);
    assertThat(ReportPeriod.weekOfMonth(d("2025-11-02"))).isEqualTo(1);
  }

  @Test
  void weekly_lastComplete() {
    ReportPeriod p = ReportPeriod.lastComplete(ReportCadence.WEEKLY, kst("2026-11-16T09:00:00"));

    assertThat(p.start()).isEqualTo(d("2026-11-09"));
    assertThat(p.end()).isEqualTo(d("2026-11-15"));
    assertThat(p.cadence()).isEqualTo(ReportCadence.WEEKLY);
    assertThat(p.title()).isEqualTo("11월 3주차 주간 리포트");
    assertThat(p.label()).isEqualTo("11월 9일 ~ 15일");
  }

  @Test
  void weekly_runMidWeek_usesPreviousFullWeek() {
    ReportPeriod p = ReportPeriod.lastComplete(ReportCadence.WEEKLY, kst("2026-11-18T09:00:00"));

    assertThat(p.start()).isEqualTo(d("2026-11-09"));
    assertThat(p.end()).isEqualTo(d("2026-11-15"));
  }

  @Test
  void weekly_utcInstantReadAsKst() {
    // UTC 로는 일요일 저녁이지만 서울로는 월요일 — 서울 날짜로 회차를 정한다.
    ReportPeriod p =
        ReportPeriod.lastComplete(
            ReportCadence.WEEKLY, OffsetDateTime.parse("2026-11-15T20:00:00Z"));

    assertThat(p.end()).isEqualTo(d("2026-11-15"));
  }

  @Test
  void biweekly_titleAcrossMonths() {
    ReportPeriod p = new ReportPeriod(d("2026-10-19"), d("2026-11-01"), ReportCadence.BIWEEKLY);

    assertThat(p.title()).isEqualTo("10월 4주차~11월 1주차 격주 리포트");
    assertThat(p.label()).isEqualTo("10월 19일 ~ 11월 1일");
  }

  @Test
  void biweekly_sameMonth() {
    ReportPeriod p = new ReportPeriod(d("2026-11-02"), d("2026-11-15"), ReportCadence.BIWEEKLY);

    assertThat(p.title()).isEqualTo("11월 2~3주차 격주 리포트");
  }

  @Test
  void biweekly_lastComplete_twoFullWeeks() {
    ReportPeriod p = ReportPeriod.lastComplete(ReportCadence.BIWEEKLY, kst("2026-11-16T09:00:00"));

    assertThat(p.start()).isEqualTo(d("2026-11-02"));
    assertThat(p.end()).isEqualTo(d("2026-11-15"));
    assertThat(p.previous().start()).isEqualTo(d("2026-10-19"));
    assertThat(p.previous().end()).isEqualTo(d("2026-11-01"));
  }

  @Test
  void monthly_lastComplete() {
    ReportPeriod p = ReportPeriod.lastComplete(ReportCadence.MONTHLY, kst("2026-12-07T09:00:00"));

    assertThat(p.start()).isEqualTo(d("2026-11-01"));
    assertThat(p.end()).isEqualTo(d("2026-11-30"));
    assertThat(p.title()).isEqualTo("11월 월간 리포트");
    assertThat(p.label()).isEqualTo("11월 1일 ~ 30일");
  }

  @Test
  void previous_monthlyIsCalendarMonth() {
    ReportPeriod nov = new ReportPeriod(d("2026-11-01"), d("2026-11-30"), ReportCadence.MONTHLY);

    ReportPeriod prev = nov.previous();

    assertThat(prev.start()).isEqualTo(d("2026-10-01"));
    assertThat(prev.end()).isEqualTo(d("2026-10-31"));
    assertThat(prev.cadence()).isEqualTo(ReportCadence.MONTHLY);
  }

  @Test
  void toMetrics_sameDates() {
    ReportPeriod p = new ReportPeriod(d("2026-11-09"), d("2026-11-15"), ReportCadence.WEEKLY);

    assertThat(p.toMetrics().from()).isEqualTo(d("2026-11-09"));
    assertThat(p.toMetrics().to()).isEqualTo(d("2026-11-15"));
    assertThat(p.previous().start()).isEqualTo(d("2026-11-02"));
  }
}
