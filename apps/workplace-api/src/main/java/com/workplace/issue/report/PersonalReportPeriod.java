package com.workplace.issue.report;

import com.workplace.issue.metrics.MetricsPeriod;
import java.time.DayOfWeek;
import java.time.LocalDate;
import java.time.LocalTime;
import java.time.OffsetDateTime;
import java.time.YearMonth;
import java.time.ZonedDateTime;
import java.time.temporal.TemporalAdjusters;
import java.util.Objects;

/**
 * 개인 보고 회차(WP-1486) — 서울 날짜 {@code start} ~ {@code end}(둘 다 포함)와 종류. 일일 = 그날, 주간 = 월~일, 월간 = 1일~말일.
 * 주차 규칙은 프로젝트 리포트와 같은 {@link ReportPeriod#weekOfMonth}(주의 달 = 일요일의 달). 제목에 해를 넣지 않고 월 묶음 폴더 이름이 해를
 * 가진다.
 *
 * @param start 첫날
 * @param end 끝날
 * @param kind 종류
 */
public record PersonalReportPeriod(LocalDate start, LocalDate end, PersonalReportKind kind) {

  /** 요일 한 글자 — {@link DayOfWeek#getValue()}(월=1) - 1 로 찾는다. */
  private static final String WEEKDAYS = "월화수목금토일";

  public PersonalReportPeriod {
    Objects.requireNonNull(start, "start");
    Objects.requireNonNull(end, "end");
    Objects.requireNonNull(kind, "kind");
    if (start.isAfter(end)) {
      throw new IllegalArgumentException("회차 시작일이 끝날보다 늦습니다");
    }
  }

  /** 하루짜리 일일 회차. */
  public static PersonalReportPeriod daily(LocalDate day) {
    return new PersonalReportPeriod(day, day, PersonalReportKind.DAILY);
  }

  /** 월~일 주간 회차 — 월요일이 아니면 IllegalArgumentException. */
  public static PersonalReportPeriod weekly(LocalDate monday) {
    if (monday.getDayOfWeek() != DayOfWeek.MONDAY) {
      throw new IllegalArgumentException("주간 보고는 월요일부터 시작해야 해요");
    }
    return new PersonalReportPeriod(monday, monday.plusDays(6), PersonalReportKind.WEEKLY);
  }

  /** 1일~말일 월간 회차. */
  public static PersonalReportPeriod monthly(YearMonth month) {
    return new PersonalReportPeriod(
        month.atDay(1), month.atEndOfMonth(), PersonalReportKind.MONTHLY);
  }

  /** anchor 가 든 하루·월~일·달로 회차를 만든다(요청에서 아무 날짜나 받아도 정규화). */
  public static PersonalReportPeriod of(PersonalReportKind kind, LocalDate anchor) {
    return switch (kind) {
      case DAILY -> daily(anchor);
      case WEEKLY -> weekly(anchor.with(TemporalAdjusters.previousOrSame(DayOfWeek.MONDAY)));
      case MONTHLY -> monthly(YearMonth.from(anchor));
    };
  }

  /** 페이지 제목 — 「11월 11일 (수) 일일 보고」「11월 2주차 주간 보고」「10월 월간 보고」. */
  public String title() {
    return switch (kind) {
      case DAILY -> label() + " 일일 보고";
      case WEEKLY -> end.getMonthValue() + "월 " + ReportPeriod.weekOfMonth(end) + "주차 주간 보고";
      case MONTHLY -> start.getMonthValue() + "월 월간 보고";
    };
  }

  /** 같은 회차에 또 만들 때의 제목 — 2번째부터 「(n)」(n≤1 이면 그대로). */
  public String titleWithCopy(int n) {
    return n <= 1 ? title() : title() + " (" + n + ")";
  }

  /** 본문 첫 줄 기간 표기 — 일일 「11월 11일 (수)」, 그 밖 프로젝트 리포트와 같은 「11월 2일 ~ 8일」. */
  public String label() {
    if (kind == PersonalReportKind.DAILY) {
      char dow = WEEKDAYS.charAt(start.getDayOfWeek().getValue() - 1);
      return start.getMonthValue() + "월 " + start.getDayOfMonth() + "일 (" + dow + ")";
    }
    return new ReportPeriod(start, end, ReportCadence.WEEKLY).label();
  }

  /** 월 묶음 폴더 이름 — 끝날 기준 「2026년 11월」. */
  public String monthFolderTitle() {
    return end.getYear() + "년 " + end.getMonthValue() + "월";
  }

  /** 지표 기간 — 진행 중 기간도 달력 기간 전체(미래 날은 0). */
  public MetricsPeriod toMetrics() {
    return new MetricsPeriod(start, end);
  }

  /** 오늘 이후에 시작하는 기간이면 거절한다(진행 중인 주·달은 통과). */
  public void requireNotFuture(LocalDate today) {
    if (start.isAfter(today)) {
      throw new IllegalArgumentException("미래 날짜의 보고는 만들 수 없어요");
    }
  }

  /**
   * 자동 일일 보고가 다룰 날짜 — now(KST) 이하의 가장 최근 「그 시각」 슬롯의 날짜 − 1일. 시각이 00:00 이면 방금 끝난 어제를, 09:00 이면
   * 전날(어제)을 만든다. 스케줄러가 늦게 돌아도 슬롯 기준이라 같은 날짜를 가리킨다.
   */
  public static LocalDate dailyTarget(LocalTime timeOfDay, OffsetDateTime now) {
    ZonedDateTime z = now.atZoneSameInstant(ReportCadence.KST);
    LocalDate slotDay = z.toLocalDate();
    if (z.toLocalTime().isBefore(timeOfDay)) {
      slotDay = slotDay.minusDays(1);
    }
    return slotDay.minusDays(1);
  }

  /** now 보다 엄격히 뒤인 첫 「그 시각」(KST). */
  public static OffsetDateTime nextRun(LocalTime timeOfDay, OffsetDateTime now) {
    ZonedDateTime z = now.atZoneSameInstant(ReportCadence.KST);
    ZonedDateTime candidate = ZonedDateTime.of(z.toLocalDate(), timeOfDay, ReportCadence.KST);
    if (!candidate.toInstant().isAfter(now.toInstant())) {
      candidate = candidate.plusDays(1);
    }
    return candidate.toOffsetDateTime();
  }
}
