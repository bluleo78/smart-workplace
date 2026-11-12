package com.workplace.issue.report;

import java.math.BigDecimal;
import java.math.RoundingMode;

/**
 * 리포트 표 숫자 표기(WP-1486) — 프로젝트 리포트(WP-1483)와 개인 보고가 같은 모양으로 숫자·변화를 쓰게 한 곳에 둔다. {@code
 * ProjectReportFactsService} 에 있던 것을 옮겼다.
 */
public final class ReportNumbers {

  /** 비교할 값이 없을 때 변화 칸. */
  public static final String DASH = "—";

  /** 음수 부호 — 하이픈이 아니라 U+2212(표 숫자 정렬·가독성, 시안과 같은 글자). */
  public static final String MINUS = "−";

  private ReportNumbers() {}

  /** 「이번」 칸 숫자. */
  public static String num(int n) {
    return String.valueOf(n);
  }

  /** 변화 칸 — {@code +n} / {@code −n}(U+2212) / {@code 0}. */
  public static String diff(int current, int previous) {
    int d = current - previous;
    if (d > 0) return "+" + d;
    if (d < 0) return MINUS + (-d);
    return "0";
  }

  /** 일수 칸 — 소수 1자리 「3.2일」(반올림), 값이 없으면(분모 0) 「—」. 개인 보고 「평균 소요」. */
  public static String days(Double v) {
    if (v == null) return DASH;
    return round1(v).toPlainString() + "일";
  }

  /**
   * 일수 변화 칸 — 「+0.3일」/「−0.5일」(U+2212)/「0일」, 한쪽이라도 값이 없으면 「—」. 표에 보이는 두 값(소수 1자리로 반올림한 값)의 차라 칸끼리
   * 어긋나지 않는다.
   */
  public static String diffDays(Double current, Double previous) {
    if (current == null || previous == null) return DASH;
    BigDecimal d = round1(current).subtract(round1(previous));
    int sign = d.signum();
    if (sign == 0) return "0일";
    return (sign > 0 ? "+" : MINUS) + d.abs().toPlainString() + "일";
  }

  /** 소수 1자리 반올림(HALF_UP) — 이진 소수 오차로 3.25 가 3.2 로 내려가지 않게 문자열 표현에서 만든다. */
  private static BigDecimal round1(double v) {
    return BigDecimal.valueOf(v).setScale(1, RoundingMode.HALF_UP);
  }
}
