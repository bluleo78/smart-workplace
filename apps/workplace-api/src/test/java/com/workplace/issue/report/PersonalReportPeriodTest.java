package com.workplace.issue.report;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.time.LocalDate;
import java.time.LocalTime;
import java.time.OffsetDateTime;
import java.time.YearMonth;
import org.junit.jupiter.api.Test;

/** 개인 보고 기간·이름 규칙(WP-1486) — 2026 달력 기준(2026-11-11 은 수요일). */
class PersonalReportPeriodTest {

  private static OffsetDateTime kst(String s) {
    return OffsetDateTime.parse(s + "+09:00");
  }

  @Test
  void daily_titleAndLabel() {
    PersonalReportPeriod p = PersonalReportPeriod.daily(LocalDate.of(2026, 11, 11));
    assertThat(p.title()).isEqualTo("11월 11일 (수) 일일 보고");
    assertThat(p.label()).isEqualTo("11월 11일 (수)");
    assertThat(p.monthFolderTitle()).isEqualTo("2026년 11월");
    assertThat(p.start()).isEqualTo(p.end());
  }

  @Test
  void weekly_titleAndLabel() {
    PersonalReportPeriod p = PersonalReportPeriod.weekly(LocalDate.of(2026, 11, 2));
    assertThat(p.end()).isEqualTo(LocalDate.of(2026, 11, 8));
    assertThat(p.title()).isEqualTo("11월 2주차 주간 보고");
    assertThat(p.label()).isEqualTo("11월 2일 ~ 8일");
  }

  @Test
  void weekly_spanningMonths() {
    PersonalReportPeriod p = PersonalReportPeriod.weekly(LocalDate.of(2026, 10, 26));
    assertThat(p.title()).isEqualTo("11월 1주차 주간 보고");
    assertThat(p.label()).isEqualTo("10월 26일 ~ 11월 1일");
    assertThat(p.monthFolderTitle()).isEqualTo("2026년 11월");
  }

  @Test
  void weekly_notMonday_throws() {
    assertThatThrownBy(() -> PersonalReportPeriod.weekly(LocalDate.of(2026, 11, 3)))
        .isInstanceOf(IllegalArgumentException.class);
  }

  @Test
  void monthly_titleAndLabel() {
    PersonalReportPeriod p = PersonalReportPeriod.monthly(YearMonth.of(2026, 10));
    assertThat(p.title()).isEqualTo("10월 월간 보고");
    assertThat(p.label()).isEqualTo("10월 1일 ~ 31일");
    assertThat(p.monthFolderTitle()).isEqualTo("2026년 10월");
  }

  @Test
  void of_normalizesAnchor() {
    PersonalReportPeriod w =
        PersonalReportPeriod.of(PersonalReportKind.WEEKLY, LocalDate.of(2026, 11, 5));
    assertThat(w.start()).isEqualTo(LocalDate.of(2026, 11, 2));
    assertThat(w.end()).isEqualTo(LocalDate.of(2026, 11, 8));
    PersonalReportPeriod m =
        PersonalReportPeriod.of(PersonalReportKind.MONTHLY, LocalDate.of(2026, 11, 5));
    assertThat(m.start()).isEqualTo(LocalDate.of(2026, 11, 1));
    assertThat(m.end()).isEqualTo(LocalDate.of(2026, 11, 30));
  }

  @Test
  void titleWithCopy_second() {
    PersonalReportPeriod p = PersonalReportPeriod.daily(LocalDate.of(2026, 11, 11));
    assertThat(p.titleWithCopy(1)).isEqualTo(p.title());
    assertThat(p.titleWithCopy(2)).isEqualTo("11월 11일 (수) 일일 보고 (2)");
  }

  @Test
  void requireNotFuture() {
    LocalDate today = LocalDate.of(2026, 11, 12);
    PersonalReportPeriod.daily(LocalDate.of(2026, 11, 12)).requireNotFuture(today);
    PersonalReportPeriod.weekly(LocalDate.of(2026, 11, 9)).requireNotFuture(today);
    assertThatThrownBy(
            () -> PersonalReportPeriod.daily(LocalDate.of(2026, 11, 13)).requireNotFuture(today))
        .isInstanceOf(IllegalArgumentException.class)
        .hasMessage("미래 날짜의 보고는 만들 수 없어요");
    assertThatThrownBy(
            () -> PersonalReportPeriod.monthly(YearMonth.of(2026, 12)).requireNotFuture(today))
        .isInstanceOf(IllegalArgumentException.class);
  }

  @Test
  void kind_parse() {
    assertThat(PersonalReportKind.parse("WEEKLY")).isEqualTo(PersonalReportKind.WEEKLY);
    assertThat(PersonalReportKind.DAILY.label()).isEqualTo("일일");
    assertThatThrownBy(() -> PersonalReportKind.parse("YEARLY"))
        .isInstanceOf(IllegalArgumentException.class);
  }

  @Test
  void dailyTarget_kstMidnightBoundary() {
    // 2026-11-11T15:30Z = 11/12 00:30 KST → 00:00 슬롯은 11/12 00:00 → 대상 11/11
    assertThat(
            PersonalReportPeriod.dailyTarget(
                LocalTime.MIDNIGHT, OffsetDateTime.parse("2026-11-11T15:30:00Z")))
        .isEqualTo(LocalDate.of(2026, 11, 11));
  }

  @Test
  void dailyTarget_beforeSlot_usesPreviousSlot() {
    LocalTime nine = LocalTime.of(9, 0);
    assertThat(PersonalReportPeriod.dailyTarget(nine, kst("2026-11-12T08:59:00")))
        .isEqualTo(LocalDate.of(2026, 11, 10));
    assertThat(PersonalReportPeriod.dailyTarget(nine, kst("2026-11-12T12:00:00")))
        .isEqualTo(LocalDate.of(2026, 11, 11));
  }

  @Test
  void nextRun_strictlyAfterNow() {
    LocalTime nine = LocalTime.of(9, 0);
    assertThat(PersonalReportPeriod.nextRun(nine, kst("2026-11-12T09:00:00")))
        .isEqualTo(kst("2026-11-13T09:00:00"));
    assertThat(PersonalReportPeriod.nextRun(nine, kst("2026-11-12T08:00:00")))
        .isEqualTo(kst("2026-11-12T09:00:00"));
  }
}
