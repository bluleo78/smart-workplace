package com.workplace.issue;

import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.issue.dto.IssueBlockerBadge;
import com.workplace.issue.dto.IssueBlockerBadge.BlockerType;
import com.workplace.issue.service.IssueBlockerCalculator;
import java.time.Instant;
import java.time.LocalDate;
import java.time.temporal.ChronoUnit;
import java.util.List;
import org.junit.jupiter.api.Test;

/** 블로커 3종 결정적 규칙 단위 테스트(순수 계산, DB 불필요). */
class IssueBlockerCalculatorTest {

  final IssueBlockerCalculator calc = new IssueBlockerCalculator();
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

  private static List<BlockerType> types(List<IssueBlockerBadge> badges) {
    return badges.stream().map(IssueBlockerBadge::type).toList();
  }

  // IssueResponse 의 전체 필드를 채우는 헬퍼 — 실제 생성자 인자 순서는 IssueResponse 정의에 맞춘다.
  private static com.workplace.issue.dto.IssueResponse issueWith(
      String status, LocalDate due, Instant updatedAt, boolean blocked) {
    return new com.workplace.issue.dto.IssueResponse(
        1L, "PRJ", 1, "제목", status, "MID", due, null, null, 1L, updatedAt, updatedAt, List.of(), 0,
        null, List.of(), null, 0, 0, List.of(), List.of(), blocked, List.of());
  }
}
