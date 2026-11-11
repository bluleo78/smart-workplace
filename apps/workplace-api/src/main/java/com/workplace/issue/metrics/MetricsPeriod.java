package com.workplace.issue.metrics;

import com.workplace.issue.dto.IssueDueWindow;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.time.temporal.ChronoUnit;

/**
 * 성과 지표의 기간 — 서울 날짜 {@code from} ~ {@code to}(둘 다 포함, WP-1476).
 *
 * <p>시각으로는 {@code [from 00:00 Asia/Seoul, to+1 00:00 Asia/Seoul)} 반열린 구간이다. JVM 기본 zone 이 UTC 라 경계
 * 계산은 항상 {@link IssueDueWindow#ZONE} 을 명시한다 — 빠뜨리면 하루 칸이 9시간 밀린다.
 *
 * <p>잘못된 입력(빈 값, from &gt; to, {@link #MAX_DAYS} 초과)은 생성 시 {@link IllegalArgumentException} 으로
 * 거절한다. 화면 이슈가 쿼리 파라미터를 그대로 넘겨도 지나치게 긴 기간이 지난 기간까지 두 배로 훑지 않게 하기 위함이다.
 */
public record MetricsPeriod(LocalDate from, LocalDate to) {

  /** 기간 상한(일) — 1년(윤년 366일) 보기와 여유를 두고 400일. 지난 기간까지 합쳐 최대 800일을 훑는다. */
  public static final int MAX_DAYS = 400;

  public MetricsPeriod {
    if (from == null || to == null) {
      throw new IllegalArgumentException("기간의 시작일과 종료일을 모두 지정해 주세요");
    }
    if (from.isAfter(to)) {
      throw new IllegalArgumentException("기간의 시작일이 종료일보다 늦습니다");
    }
    if (inclusiveDays(from, to) > MAX_DAYS) {
      throw new IllegalArgumentException("기간은 최대 " + MAX_DAYS + "일까지 지정할 수 있습니다");
    }
  }

  /** 기간 길이(일, 양 끝 포함). 하루짜리 기간은 1. */
  public long days() {
    return inclusiveDays(from, to);
  }

  /**
   * 양 끝 포함 일수 — 생성자 검증과 {@link #days()} 가 함께 쓴다. compact 생성자 안에서는 필드가 아직 대입되지 않아 {@link #days()} 를
   * 부를 수 없어서 정적 헬퍼로 둔다.
   */
  private static long inclusiveDays(LocalDate from, LocalDate to) {
    return ChronoUnit.DAYS.between(from, to) + 1;
  }

  /** 같은 길이의 바로 앞 기간 — 길이 N일이면 {@code [from−N, from−1]}. 「지난 기간 대비」 비교에 쓴다. */
  public MetricsPeriod previous() {
    long n = days();
    return new MetricsPeriod(from.minusDays(n), from.minusDays(1));
  }

  /** 기간 시작 시각(서울 from 00:00, 포함). 이슈 날짜 필터와 같은 경계 헬퍼를 쓴다. */
  public OffsetDateTime startInclusive() {
    return IssueDueWindow.startOfDay(from);
  }

  /** 기간 끝 시각(서울 to+1 00:00, 제외). */
  public OffsetDateTime endExclusive() {
    return IssueDueWindow.endOfDayExclusive(to);
  }

  /** 서울 날짜가 기간 안(양 끝 포함)인가. */
  public boolean contains(LocalDate date) {
    return date != null && !date.isBefore(from) && !date.isAfter(to);
  }
}
