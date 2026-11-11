package com.workplace.issue.dto;

import java.time.Clock;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.time.ZoneId;

/**
 * 「마감 지남·오늘」 창(WP-1104) — 홈 AI 우선순위 배치 후보와 읽을 때 다시 보기가 같은 「오늘」·하한을 쓰게 한 곳에 둔다.
 *
 * <p>JVM 기본 시간대는 UTC 로 고정돼 있어(WorkplaceApplication) {@code LocalDate.now()} 는 매일 00:00~09:00 KST 에
 * 전날이 된다 — 그러면 오늘 마감 이슈가 후보에서 빠진다. 이슈 날짜 필터(IssueRepository)와 같은 Asia/Seoul 로 하루를 자른다.
 */
public final class IssueDueWindow {

  /** 이슈 마감의 하루 경계 — 이슈 날짜 필터·AI 비서와 같은 기준. */
  public static final ZoneId ZONE = ZoneId.of("Asia/Seoul");

  private IssueDueWindow() {}

  /** clock 기준 Asia/Seoul 의 오늘. */
  public static LocalDate today(Clock clock) {
    return LocalDate.now(clock.withZone(ZONE));
  }

  /** 시각 t 가 속한 Asia/Seoul 날짜 — 이미 잡은 「지금」을 서울 날짜로 바꾸는 곳(내 개요·업무 프로파일)이 같은 변환을 쓰게 한다. */
  public static LocalDate seoulDate(OffsetDateTime t) {
    return t.atZoneSameInstant(ZONE).toLocalDate();
  }

  /**
   * 서울 날짜 하루의 시작 시각(00:00 KST, 포함). 서울 날짜 범위를 시각 범위로 바꾸는 곳(이슈 날짜 필터, 성과 지표 기간 WP-1476)이 같은 경계를 쓰게 한
   * 곳에 둔다 — JVM 기본 zone(UTC)으로 자르면 하루가 9시간 밀린다.
   */
  public static OffsetDateTime startOfDay(LocalDate date) {
    return date.atStartOfDay(ZONE).toOffsetDateTime();
  }

  /** 서울 날짜 하루의 끝 경계(다음 날 00:00 KST, 제외) — {@link #startOfDay} 와 짝. */
  public static OffsetDateTime endOfDayExclusive(LocalDate date) {
    return startOfDay(date.plusDays(1));
  }

  /** 창의 하한 — 1년 넘게 지난 마감은 홈(SynthesisLayer)에도 보이지 않는다. */
  public static LocalDate from(LocalDate today) {
    return today.minusYears(1);
  }
}
