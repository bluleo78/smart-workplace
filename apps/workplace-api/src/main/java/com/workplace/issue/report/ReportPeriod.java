package com.workplace.issue.report;

import com.workplace.issue.metrics.MetricsPeriod;
import java.time.DayOfWeek;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.time.temporal.ChronoUnit;
import java.time.temporal.TemporalAdjusters;
import java.util.Objects;

/**
 * 리포트 회차(WP-1483) — 서울 날짜 {@code start} ~ {@code end}(둘 다 포함)와 주기.
 *
 * <p>회차는 늘 「실행 시각 전에 끝난 가장 최근 완전 회차」다(주 = 월~일 KST) — 숫자가 닫힌 기간이라 다시 만들어도 같다. 주차 규칙은 「주의 달 = 그 주
 * 일요일(끝날)의 달, 그 달 1일이 든 주가 1주차」(시안 「10월 20~26일 = 10월 4주차」「11월 3~9일 = 11월 2주차」와 맞고, 1주차가 빠지는 달이 없다).
 *
 * @param start 첫날(주간·격주는 월요일, 월간은 1일)
 * @param end 끝날(주간·격주는 일요일, 월간은 말일)
 * @param cadence 주기
 */
public record ReportPeriod(LocalDate start, LocalDate end, ReportCadence cadence) {

  public ReportPeriod {
    Objects.requireNonNull(start, "start");
    Objects.requireNonNull(end, "end");
    Objects.requireNonNull(cadence, "cadence");
    if (start.isAfter(end)) {
      throw new IllegalArgumentException("회차 시작일이 끝날보다 늦습니다");
    }
  }

  /**
   * 실행 시각(서울 날짜) 전에 끝난 가장 최근 완전 회차.
   *
   * <ul>
   *   <li>WEEKLY: 실행일 전날 이전의 가장 가까운 일요일로 끝나는 월~일
   *   <li>BIWEEKLY: 그 주와 그 앞 주(월~일 두 주)
   *   <li>MONTHLY: 실행일이 속한 달의 지난 달 1일~말일
   * </ul>
   */
  public static ReportPeriod lastComplete(ReportCadence cadence, OffsetDateTime runAt) {
    LocalDate runDate = runAt.atZoneSameInstant(ReportCadence.KST).toLocalDate();
    return switch (cadence) {
      case WEEKLY, BIWEEKLY -> {
        // 실행일 당일은 아직 끝나지 않았으므로 전날부터 거슬러 첫 일요일이 끝날.
        LocalDate end =
            runDate.minusDays(1).with(TemporalAdjusters.previousOrSame(DayOfWeek.SUNDAY));
        int weeks = cadence == ReportCadence.WEEKLY ? 1 : 2;
        yield new ReportPeriod(end.minusDays(7L * weeks - 1), end, cadence);
      }
      case MONTHLY -> {
        LocalDate first = runDate.withDayOfMonth(1).minusMonths(1);
        yield new ReportPeriod(first, first.with(TemporalAdjusters.lastDayOfMonth()), cadence);
      }
    };
  }

  /** 바로 앞 같은 주기 회차 — 주간·격주는 같은 길이만큼 앞, 월간은 지난 달력 달(길이가 달라도). 「완료」「새로 생김」 변화 비교에 쓴다. */
  public ReportPeriod previous() {
    if (cadence == ReportCadence.MONTHLY) {
      LocalDate first = start.withDayOfMonth(1).minusMonths(1);
      return new ReportPeriod(first, first.with(TemporalAdjusters.lastDayOfMonth()), cadence);
    }
    long days = ChronoUnit.DAYS.between(start, end) + 1;
    return new ReportPeriod(start.minusDays(days), start.minusDays(1), cadence);
  }

  /** 지표 모듈 기간으로 바꾼다(같은 날짜, 양 끝 포함). */
  public MetricsPeriod toMetrics() {
    return new MetricsPeriod(start, end);
  }

  /**
   * 페이지 제목 — 「11월 2주차 주간 리포트」, 「11월 1~2주차 격주 리포트」(달이 넘어가면 「10월 4주차~11월 1주차 격주 리포트」), 「10월 월간 리포트」.
   */
  public String title() {
    return switch (cadence) {
      case WEEKLY -> week(end) + " 주간 리포트";
      case BIWEEKLY -> {
        // 두 주 각각의 일요일로 주차를 정한다 — 첫 주 일요일 = start+6, 둘째 주 일요일 = end.
        LocalDate firstSunday = start.plusDays(6);
        if (firstSunday.getMonthValue() == end.getMonthValue()) {
          yield end.getMonthValue()
              + "월 "
              + weekOfMonth(firstSunday)
              + "~"
              + weekOfMonth(end)
              + "주차 격주 리포트";
        }
        yield week(firstSunday) + "~" + week(end) + " 격주 리포트";
      }
      case MONTHLY -> start.getMonthValue() + "월 월간 리포트";
    };
  }

  /** 본문 첫 줄 기간 표기 — 「11월 3일 ~ 9일」, 달이 다르면 「10월 27일 ~ 11월 2일」. AI 에 {@code periodLabel} 로 준다. */
  public String label() {
    String head = start.getMonthValue() + "월 " + start.getDayOfMonth() + "일 ~ ";
    if (start.getMonthValue() == end.getMonthValue() && start.getYear() == end.getYear()) {
      return head + end.getDayOfMonth() + "일";
    }
    return head + end.getMonthValue() + "월 " + end.getDayOfMonth() + "일";
  }

  /**
   * 일요일(주의 끝날)이 그 달 몇째 주인가 — n = ceil((일요일의 일 + (그 달 1일의 요일번호 − 1)) / 7), 요일번호 월=1…일=7. 1일이 든 주가
   * 1주차다.
   */
  public static int weekOfMonth(LocalDate sunday) {
    int offset = sunday.withDayOfMonth(1).getDayOfWeek().getValue() - 1;
    return (int) Math.ceil((sunday.getDayOfMonth() + offset) / 7.0);
  }

  /** 「M월 n주차」 — 주의 달은 일요일의 달. */
  private static String week(LocalDate sunday) {
    return sunday.getMonthValue() + "월 " + weekOfMonth(sunday) + "주차";
  }
}
