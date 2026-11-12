package com.workplace.issue.report;

import java.time.DayOfWeek;
import java.time.LocalDate;
import java.time.LocalTime;
import java.time.OffsetDateTime;
import java.time.ZoneId;
import java.time.ZonedDateTime;
import java.time.temporal.TemporalAdjusters;

/**
 * 프로젝트 리포트 주기(WP-1483) — 매주·격주·매월. 요일·시각 설정 하나로 세 주기를 같은 화면에 둔다(설계 「내가 정한 것」). 모든 시각 계산은 KST.
 *
 * <ul>
 *   <li>WEEKLY: {@code after} 이후 처음 오는 그 요일·시각
 *   <li>BIWEEKLY: 처음 켤 때(지난 예정 없음)는 매주와 같고, 실행 뒤에는 지난 예정 + 14일 — 그것도 지났으면 2주 칸을 건너뛴다
 *   <li>MONTHLY: {@code after} 이후 처음 오는 「그 달 첫 번째 그 요일」·시각
 * </ul>
 */
public enum ReportCadence {
  WEEKLY("주간"),
  BIWEEKLY("격주"),
  MONTHLY("월간");

  /** 리포트 시각의 기준 시간대 — 설정의 요일·시각은 KST 로 읽는다. */
  public static final ZoneId KST = ZoneId.of("Asia/Seoul");

  private final String label;

  ReportCadence(String label) {
    this.label = label;
  }

  /** 화면·제목에 쓰는 이름(주간|격주|월간). */
  public String label() {
    return label;
  }

  /** 저장된·요청된 이름을 읽는다. 모르는 값이면 IllegalArgumentException(요청이면 400). */
  public static ReportCadence parse(String value) {
    for (ReportCadence c : values()) {
      if (c.name().equals(value)) {
        return c;
      }
    }
    throw new IllegalArgumentException("리포트 주기는 WEEKLY·BIWEEKLY·MONTHLY 중 하나여야 합니다");
  }

  /**
   * 다음 실행 시각(KST 오프셋으로 돌려준다). 결과는 늘 {@code after} 보다 뒤다.
   *
   * @param weekday 실행 요일
   * @param time 실행 시각(KST)
   * @param after 이 시각 이후에서 찾는다(보통 지금)
   * @param previousScheduled 지난 예정 시각 — 격주에서만 쓴다. null 이면 처음 켠 것으로 보고 매주와 같다
   */
  public OffsetDateTime nextRun(
      DayOfWeek weekday, LocalTime time, OffsetDateTime after, OffsetDateTime previousScheduled) {
    ZonedDateTime from = after.atZoneSameInstant(KST);
    ZonedDateTime next =
        switch (this) {
          case WEEKLY -> nextWeekly(weekday, time, from);
          case BIWEEKLY -> nextBiweekly(weekday, time, from, previousScheduled);
          case MONTHLY -> nextMonthly(weekday, time, from);
        };
    return next.toOffsetDateTime();
  }

  /** from 이후(같은 시각 제외) 처음 오는 그 요일·시각 — 오늘이 그 요일이고 시각 전이면 오늘. */
  private static ZonedDateTime nextWeekly(DayOfWeek weekday, LocalTime time, ZonedDateTime from) {
    LocalDate day = from.toLocalDate().with(TemporalAdjusters.nextOrSame(weekday));
    ZonedDateTime candidate = ZonedDateTime.of(day, time, KST);
    return candidate.isAfter(from) ? candidate : candidate.plusWeeks(1);
  }

  /** 지난 예정 + 14일, 이미 지났으면 지날 때까지 14일씩 더한다(밀린 칸을 한꺼번에 돌리지 않게). */
  private static ZonedDateTime nextBiweekly(
      DayOfWeek weekday, LocalTime time, ZonedDateTime from, OffsetDateTime previousScheduled) {
    if (previousScheduled == null) {
      return nextWeekly(weekday, time, from);
    }
    ZonedDateTime candidate = previousScheduled.atZoneSameInstant(KST).plusWeeks(2);
    while (!candidate.isAfter(from)) {
      candidate = candidate.plusWeeks(2);
    }
    return candidate;
  }

  /** from 의 달 첫 번째 그 요일이 아직이면 그것, 지났으면 다음 달 첫 번째 그 요일. */
  private static ZonedDateTime nextMonthly(DayOfWeek weekday, LocalTime time, ZonedDateTime from) {
    LocalDate month = from.toLocalDate().withDayOfMonth(1);
    ZonedDateTime candidate = firstWeekdayAt(month, weekday, time);
    return candidate.isAfter(from) ? candidate : firstWeekdayAt(month.plusMonths(1), weekday, time);
  }

  /** 그 달 첫 번째 그 요일의 그 시각(KST). */
  private static ZonedDateTime firstWeekdayAt(
      LocalDate firstOfMonth, DayOfWeek weekday, LocalTime time) {
    return ZonedDateTime.of(firstOfMonth.with(TemporalAdjusters.firstInMonth(weekday)), time, KST);
  }
}
