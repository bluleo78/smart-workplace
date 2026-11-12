package com.workplace.issue.report;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.time.DayOfWeek;
import java.time.LocalTime;
import java.time.OffsetDateTime;
import org.junit.jupiter.api.Test;

/**
 * 리포트 주기(WP-1483) 다음 실행 시각 — 매주는 다음 그 요일·시각, 격주는 지난 예정 + 14일(놓친 칸 건너뜀), 매월은 그 달 첫 번째 그 요일. 모두 KST.
 */
class ReportCadenceTest {

  private static final LocalTime NINE = LocalTime.of(9, 0);

  /** 목요일 10시 이후 매주 월요일 9시 → 다음 주 월요일 9시. */
  @Test
  void weekly_nextRun_isNextMonday0900() {
    OffsetDateTime after = OffsetDateTime.parse("2026-11-12T10:00:00+09:00");
    assertThat(ReportCadence.WEEKLY.nextRun(DayOfWeek.MONDAY, NINE, after, null))
        .isEqualTo(OffsetDateTime.parse("2026-11-16T09:00:00+09:00"));
  }

  /** 그 요일 그 시각 전이면 오늘. UTC 로 넘겨도 KST 로 판단한다. */
  @Test
  void weekly_sameDayBeforeTime_isToday() {
    OffsetDateTime after = OffsetDateTime.parse("2026-11-15T23:30:00Z"); // KST 11-16(월) 08:30
    assertThat(ReportCadence.WEEKLY.nextRun(DayOfWeek.MONDAY, NINE, after, null))
        .isEqualTo(OffsetDateTime.parse("2026-11-16T09:00:00+09:00"));
  }

  /** 처음 켤 때는 매주와 같고, 실행 뒤에는 지난 예정 + 14일. */
  @Test
  void biweekly_afterRun_addsFourteenDays() {
    OffsetDateTime first =
        ReportCadence.BIWEEKLY.nextRun(
            DayOfWeek.MONDAY, NINE, OffsetDateTime.parse("2026-11-12T10:00:00+09:00"), null);
    assertThat(first).isEqualTo(OffsetDateTime.parse("2026-11-16T09:00:00+09:00"));
    OffsetDateTime prev = OffsetDateTime.parse("2026-11-16T09:00:00+09:00");
    assertThat(
            ReportCadence.BIWEEKLY.nextRun(
                DayOfWeek.MONDAY, NINE, OffsetDateTime.parse("2026-11-16T09:01:00+09:00"), prev))
        .isEqualTo(OffsetDateTime.parse("2026-11-30T09:00:00+09:00"));
  }

  /** 서버가 오래 꺼져 지난 예정 + 14일도 지났으면 2주 칸을 건너뛰어 다음 칸. */
  @Test
  void biweekly_skipsMissedSlots() {
    OffsetDateTime prev = OffsetDateTime.parse("2026-11-16T09:00:00+09:00");
    OffsetDateTime after = OffsetDateTime.parse("2026-12-05T12:00:00+09:00");
    assertThat(ReportCadence.BIWEEKLY.nextRun(DayOfWeek.MONDAY, NINE, after, prev))
        .isEqualTo(OffsetDateTime.parse("2026-12-14T09:00:00+09:00"));
  }

  /** 매월 = 그 달 첫 번째 월요일 — 11월 첫 월요일(11/2)이 지났으면 12월 첫 월요일(12/7). */
  @Test
  void monthly_isFirstWeekdayOfNextMonth() {
    OffsetDateTime after = OffsetDateTime.parse("2026-11-12T10:00:00+09:00");
    assertThat(ReportCadence.MONTHLY.nextRun(DayOfWeek.MONDAY, NINE, after, null))
        .isEqualTo(OffsetDateTime.parse("2026-12-07T09:00:00+09:00"));
  }

  /** 이름 읽기와 화면 이름. 모르는 값은 400 이 되는 IllegalArgumentException. */
  @Test
  void parse_and_label() {
    assertThat(ReportCadence.parse("BIWEEKLY")).isEqualTo(ReportCadence.BIWEEKLY);
    assertThat(ReportCadence.WEEKLY.label()).isEqualTo("주간");
    assertThat(ReportCadence.BIWEEKLY.label()).isEqualTo("격주");
    assertThat(ReportCadence.MONTHLY.label()).isEqualTo("월간");
    assertThatThrownBy(() -> ReportCadence.parse("DAILY"))
        .isInstanceOf(IllegalArgumentException.class);
  }
}
