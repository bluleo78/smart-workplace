package com.workplace.issue;

import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.issue.dto.IssueBlockerBadge;
import com.workplace.issue.dto.IssueBlockerBadge.BlockerType;
import com.workplace.issue.service.IssueBlockerCalculator;
import com.workplace.issue.service.IssueClock;
import java.time.Clock;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.time.temporal.ChronoUnit;
import java.util.List;
import org.junit.jupiter.api.Test;

/** 블로커 3종 결정적 규칙 단위 테스트(순수 계산, DB 불필요). */
class IssueBlockerCalculatorTest {

  final IssueBlockerCalculator calc = new IssueBlockerCalculator(new IssueClock());
  final LocalDate today = LocalDate.of(2026, 6, 27);
  final Instant now = today.atStartOfDay(java.time.ZoneOffset.UTC).toInstant();

  @Test
  void overdue_whenDueTomorrowOrEarlier_andNotDone() {
    var issue = issueWith("IN_PROGRESS", today.plusDays(1), now, false);
    assertThat(types(calc.compute(issue, today, now))).contains(BlockerType.OVERDUE);
  }

  @Test
  void noOverdue_whenDone() {
    var issue = issueWith("DONE", today.minusDays(5), now, false);
    assertThat(types(calc.compute(issue, today, now))).doesNotContain(BlockerType.OVERDUE);
  }

  @Test
  void stale_whenInProgress_andNotUpdatedForThreeDays() {
    var old = now.minus(4, ChronoUnit.DAYS);
    var issue = issueWith("IN_PROGRESS", null, old, false);
    assertThat(types(calc.compute(issue, today, now))).contains(BlockerType.STALE);
  }

  @Test
  void noStale_whenTodoEvenIfOld() {
    var old = now.minus(10, ChronoUnit.DAYS);
    var issue = issueWith("TODO", null, old, false);
    assertThat(types(calc.compute(issue, today, now))).doesNotContain(BlockerType.STALE);
  }

  @Test
  void blocked_whenBlockedFlagTrue() {
    var issue = issueWith("IN_PROGRESS", null, now, true);
    assertThat(types(calc.compute(issue, today, now))).contains(BlockerType.BLOCKED);
  }

  /** UTC 11-15 18:00 = KST 11-16 03:00 — 서울 오늘(11-16)+1 = 11-17 이라 배지 대상(WP-1617). */
  @Test
  void overdue_usesSeoulToday_duringKstEarlyMorning() {
    assertThat(dueBadgesAt("2026-11-15T18:00:00Z")).contains(BlockerType.OVERDUE);
  }

  /**
   * UTC 11-15 15:00:00 = KST 11-16 00:00 정각 — 서울/UTC 날짜를 가르는 경계, 서울 오늘+1 = 11-17 이라 배지 대상(WP-1617).
   */
  @Test
  void overdue_atSeoulMidnight_exactly() {
    assertThat(dueBadgesAt("2026-11-15T15:00:00Z")).contains(BlockerType.OVERDUE);
  }

  /** UTC 11-15 14:59:59 = KST 11-15 23:59:59 — 서울 오늘+1 = 11-16 이라 11-17 마감은 아직 아님(WP-1617). */
  @Test
  void noOverdue_justBeforeSeoulMidnight() {
    assertThat(dueBadgesAt("2026-11-15T14:59:59Z")).doesNotContain(BlockerType.OVERDUE);
  }

  /** STALE 의 「지금」도 계산기 시계에서 나온다(WP-1617). */
  @Test
  void stale_usesClockInstant() {
    var issue = issueWith("IN_PROGRESS", null, Instant.parse("2026-11-11T18:00:00Z"), false);
    assertThat(types(calcAt("2026-11-15T18:00:00Z").compute(issue))).contains(BlockerType.STALE);
  }

  /** 시각 utc 에 고정한 시계로 만든 계산기(WP-1617). */
  private static IssueBlockerCalculator calcAt(String utc) {
    return new IssueBlockerCalculator(
        new IssueClock(Clock.fixed(Instant.parse(utc), ZoneOffset.UTC)));
  }

  /** 시각 utc 에 마감 2026-11-17 진행 중 이슈의 배지 종류 — 서울 날짜 경계 테스트 공통(WP-1617). */
  private static List<BlockerType> dueBadgesAt(String utc) {
    var issue = issueWith("IN_PROGRESS", LocalDate.of(2026, 11, 17), Instant.parse(utc), false);
    return types(calcAt(utc).compute(issue));
  }

  private static List<BlockerType> types(List<IssueBlockerBadge> badges) {
    return badges.stream().map(IssueBlockerBadge::type).toList();
  }

  // IssueResponse 의 전체 필드를 채우는 헬퍼 — 실제 생성자 인자 순서는 IssueResponse 정의에 맞춘다.
  private static com.workplace.issue.dto.IssueResponse issueWith(
      String status, LocalDate due, Instant updatedAt, boolean blocked) {
    return new com.workplace.issue.dto.IssueResponse(
        1L, "PRJ", 1, "제목", status, null, null, null, "MID", due, null, null, null, 1L, updatedAt,
        updatedAt, null, List.of(), 0, null, List.of(), null, 0, 0, List.of(), List.of(), blocked,
        List.of(), 1, List.of(), null, null, null, null, null, List.of());
  }
}
