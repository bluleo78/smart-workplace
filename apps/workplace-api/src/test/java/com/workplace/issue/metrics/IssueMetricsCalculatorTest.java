package com.workplace.issue.metrics;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.assertj.core.groups.Tuple.tuple;

import com.workplace.issue.metrics.IssueMetricsCalculator.AssigneeChange;
import com.workplace.issue.metrics.IssueMetricsCalculator.DueChange;
import com.workplace.issue.metrics.IssueMetricsCalculator.IssueInput;
import com.workplace.issue.metrics.IssueMetricsRepository.ClosedCandidate;
import com.workplace.issue.metrics.IssueMetricsRepository.HistoryEvent;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.regex.Pattern;
import org.junit.jupiter.api.Test;

/** WP-1476 — {@link IssueMetricsCalculator} 순수 계산 경계(DB 없음). 통합 테스트보다 촘촘하게 정의의 모서리를 고정한다. */
class IssueMetricsCalculatorTest {

  private static final OffsetDateTime CLOSED = OffsetDateTime.parse("2026-11-09T03:00:00Z");

  /** 사람 종류 — 9 는 AI, 나머지는 사람. 종류는 이력 payload 가 아니라 이 조회 결과로만 정한다. */
  private static final Map<Long, String> KINDS =
      Map.of(1L, "HUMAN", 2L, "HUMAN", 3L, "HUMAN", 9L, "AGENT");

  private static ClosedCandidate candidate(LocalDate due) {
    return new ClosedCandidate(1L, 10L, CLOSED.minusDays(2), CLOSED, due);
  }

  private static IssueInput input(
      LocalDate currentDue,
      List<AssigneeChange> assignees,
      List<DueChange> dues,
      Set<Long> current,
      OffsetDateTime agentRunAt) {
    return new IssueInput(candidate(currentDue), assignees, dues, current, agentRunAt);
  }

  private static IssueInput assigneesOnly(List<AssigneeChange> changes, Set<Long> current) {
    return input(null, changes, List.of(), current, null);
  }

  private static boolean withAi(IssueInput in) {
    return IssueMetricsCalculator.evaluate(in, KINDS).fact().withAi();
  }

  private static HistoryEvent ev(String type, String from, String to) {
    return new HistoryEvent(1L, 1L, type, from, to, CLOSED);
  }

  private static ClosedIssueFact fact(LocalDate closedDate, DueOutcome outcome, Integer late) {
    return new ClosedIssueFact(
        1L,
        10L,
        closedDate.atStartOfDay().atOffset(ZoneOffset.UTC),
        closedDate,
        null,
        outcome,
        late,
        1.0,
        false);
  }

  // ---------------------------------------------------------------- 기간

  @Test
  void period_rejects_reversed_and_too_long_and_null() {
    assertThatThrownBy(
            () -> new MetricsPeriod(LocalDate.of(2026, 11, 2), LocalDate.of(2026, 11, 1)))
        .isInstanceOf(IllegalArgumentException.class)
        .hasMessageContaining("시작일");
    assertThatThrownBy(() -> new MetricsPeriod(LocalDate.of(2025, 1, 1), LocalDate.of(2026, 2, 5)))
        .isInstanceOf(IllegalArgumentException.class)
        .hasMessageContaining("400");
    assertThatThrownBy(() -> new MetricsPeriod(null, LocalDate.of(2026, 1, 1)))
        .isInstanceOf(IllegalArgumentException.class);
    // 정확히 400일은 허용
    assertThat(
            new MetricsPeriod(LocalDate.of(2026, 1, 1), LocalDate.of(2026, 1, 1).plusDays(399))
                .days())
        .isEqualTo(400);
  }

  @Test
  void period_previous_and_seoul_bounds() {
    var p = new MetricsPeriod(LocalDate.of(2026, 11, 3), LocalDate.of(2026, 11, 9));
    assertThat(p.previous())
        .isEqualTo(new MetricsPeriod(LocalDate.of(2026, 10, 27), LocalDate.of(2026, 11, 2)));
    assertThat(p.startInclusive().toInstant())
        .isEqualTo(OffsetDateTime.parse("2026-11-02T15:00:00Z").toInstant());
    assertThat(p.endExclusive().toInstant())
        .isEqualTo(OffsetDateTime.parse("2026-11-09T15:00:00Z").toInstant());
  }

  @Test
  void seoul_date_midnight_boundary() {
    assertThat(IssueMetricsCalculator.seoulDate(OffsetDateTime.parse("2026-11-09T15:00:00Z")))
        .isEqualTo(LocalDate.of(2026, 11, 10));
    assertThat(IssueMetricsCalculator.seoulDate(OffsetDateTime.parse("2026-11-09T14:59:59Z")))
        .isEqualTo(LocalDate.of(2026, 11, 9));
  }

  // ---------------------------------------------------------------- 파싱

  @Test
  void parse_assignee_change_tolerates_broken_payloads_and_reads_ids_only() {
    assertThat(IssueMetricsCalculator.parseAssigneeChange(ev("ASSIGNEES_CHANGED", null, "{bad")))
        .isEmpty();
    assertThat(IssueMetricsCalculator.parseAssigneeChange(ev("ASSIGNEES_CHANGED", null, "[1]")))
        .isEmpty();
    assertThat(IssueMetricsCalculator.parseAssigneeChange(ev("ASSIGNEES_CHANGED", null, null)))
        .isEmpty();
    var parsed =
        IssueMetricsCalculator.parseAssigneeChange(
                ev(
                    "ASSIGNEES_CHANGED",
                    null,
                    "{\"added\":[{\"id\":5,\"username\":\"a\",\"kind\":\"AGENT\"},{\"username\":\"noid\"}],"
                        + "\"removed\":\"x\",\"reason\":\"COMPONENT_DEFAULT\",\"componentId\":9}"))
            .orElseThrow();
    assertThat(parsed.added()).containsExactly(5L);
    assertThat(parsed.removed()).isEmpty();
  }

  @Test
  void parse_due_change_null_and_invalid() {
    var cleared =
        IssueMetricsCalculator.parseDueChange(ev("DUE_DATE_CHANGED", "2026-11-10", null))
            .orElseThrow();
    assertThat(cleared.from()).isEqualTo(LocalDate.of(2026, 11, 10));
    assertThat(cleared.to()).isNull();
    assertThat(IssueMetricsCalculator.parseDueChange(ev("DUE_DATE_CHANGED", "x", "y"))).isEmpty();
  }

  // ---------------------------------------------------------------- 닫힐 당시 마감일

  @Test
  void due_at_close_rules() {
    LocalDate d5 = LocalDate.of(2026, 11, 5);
    LocalDate d10 = LocalDate.of(2026, 11, 10);
    // 이력 없음 → 현재 마감일
    assertThat(IssueMetricsCalculator.dueAtClose(input(d5, List.of(), List.of(), Set.of(), null)))
        .isEqualTo(d5);
    // 닫힌 뒤 변경만 → 첫 변경의 from
    var after = new DueChange(CLOSED.plusHours(1), d10, d5);
    assertThat(
            IssueMetricsCalculator.dueAtClose(input(d5, List.of(), List.of(after), Set.of(), null)))
        .isEqualTo(d10);
    // 닫히기 전(같은 시각 포함) 마지막 변경의 to
    var atClose = new DueChange(CLOSED, null, d10);
    assertThat(
            IssueMetricsCalculator.dueAtClose(
                input(d5, List.of(), List.of(atClose, after), Set.of(), null)))
        .isEqualTo(d10);
    // 닫히기 전에 마감을 지웠다 → 현재 값이 있어도 마감 없음
    var clearedBefore = new DueChange(CLOSED.minusHours(1), d10, null);
    assertThat(
            IssueMetricsCalculator.dueAtClose(
                input(d5, List.of(), List.of(clearedBefore), Set.of(), null)))
        .isNull();
  }

  @Test
  void evaluate_outcome_and_late_days_and_lead_time() {
    // 닫힌 서울 날짜 11-09. 마감 11-09 → 기한 내(같은 날), 11-07 → 2일 초과, null → 마감 없음
    var onTime =
        IssueMetricsCalculator.evaluate(
                input(LocalDate.of(2026, 11, 9), List.of(), List.of(), Set.of(), null), KINDS)
            .fact();
    assertThat(onTime.outcome()).isEqualTo(DueOutcome.ON_TIME);
    assertThat(onTime.lateDays()).isNull();
    assertThat(onTime.leadTimeDays()).isEqualTo(2.0);
    var late =
        IssueMetricsCalculator.evaluate(
                input(LocalDate.of(2026, 11, 7), List.of(), List.of(), Set.of(), null), KINDS)
            .fact();
    assertThat(late.outcome()).isEqualTo(DueOutcome.OVERDUE);
    assertThat(late.lateDays()).isEqualTo(2);
    var none =
        IssueMetricsCalculator.evaluate(input(null, List.of(), List.of(), Set.of(), null), KINDS)
            .fact();
    assertThat(none.outcome()).isEqualTo(DueOutcome.NO_DUE);
  }

  @Test
  void negative_lead_time_is_null_and_excluded_from_summary() {
    var bad = new ClosedCandidate(2L, 10L, CLOSED.plusDays(1), CLOSED, null);
    var badFact =
        IssueMetricsCalculator.evaluate(
                new IssueInput(bad, List.of(), List.of(), Set.of(), null), KINDS)
            .fact();
    assertThat(badFact.leadTimeDays()).isNull();
    var good =
        IssueMetricsCalculator.evaluate(input(null, List.of(), List.of(), Set.of(), null), KINDS)
            .fact();
    var s = IssueMetricsCalculator.summarize(List.of(badFact, good), 0);
    assertThat(s.completed()).isEqualTo(2);
    assertThat(s.leadTimeDaysAvg()).isEqualTo(2.0);
    assertThat(s.leadTimeDaysMedian()).isEqualTo(2.0);
    // 전부 음수면 평균·중간값은 null
    var onlyBad = IssueMetricsCalculator.summarize(List.of(badFact), 0);
    assertThat(onlyBad.leadTimeDaysAvg()).isNull();
    assertThat(onlyBad.leadTimeDaysMedian()).isNull();
  }

  // ---------------------------------------------------------------- 닫힐 때 담당자·AI와 함께

  @Test
  void assignees_at_close_undoes_changes_after_close_only() {
    // 현재 C(3). 닫힌 뒤 B(2)→C 로 바뀜. 닫히기 전 A(1)→B 는 되돌리지 않는다.
    var beforeClose = new AssigneeChange(CLOSED.minusHours(1), List.of(2L), List.of(1L));
    var afterClose = new AssigneeChange(CLOSED.plusHours(1), List.of(3L), List.of(2L));
    var in = assigneesOnly(List.of(beforeClose, afterClose), Set.of(3L));
    assertThat(IssueMetricsCalculator.assigneesAtClose(in)).containsExactly(2L);
  }

  @Test
  void kind_comes_from_user_kinds_not_payload() {
    // 닫힐 때 담당자가 9 — 종류 조회에서 AGENT 이므로 (a) 로 AI와 함께. 종류를 모르면(조회에 없음) AI 로 보지 않는다.
    var in = assigneesOnly(List.of(), Set.of(9L));
    var atClose = IssueMetricsCalculator.assigneesAtClose(in);
    assertThat(IssueMetricsCalculator.withAi(in, atClose, KINDS)).isTrue();
    assertThat(IssueMetricsCalculator.withAi(in, atClose, Map.of())).isFalse();
  }

  @Test
  void with_ai_rules() {
    // 아무것도 없음
    assertThat(withAi(assigneesOnly(List.of(), Set.of(1L)))).isFalse();
    // (a) 현재(=닫힐 때) 담당자에 AGENT
    assertThat(withAi(assigneesOnly(List.of(), Set.of(9L)))).isTrue();
    // (b) 닫히기 전 added 에 AGENT(지금은 빠져 있음)
    var addedBefore = new AssigneeChange(CLOSED.minusDays(1), List.of(9L), List.of());
    var removedBefore = new AssigneeChange(CLOSED.minusHours(1), List.of(), List.of(9L));
    assertThat(withAi(assigneesOnly(List.of(addedBefore, removedBefore), Set.of(1L)))).isTrue();
    // 닫힌 뒤 added 는 세지 않음(재구성으로 닫힐 때 담당자에서도 빠진다)
    var addedAfter = new AssigneeChange(CLOSED.plusHours(1), List.of(9L), List.of());
    assertThat(withAi(assigneesOnly(List.of(addedAfter), Set.of(1L, 9L)))).isFalse();
    // (c) AI 가 실제로 일한 시각이 닫힌 시각 이하면 true, 뒤면 false
    assertThat(withAi(input(null, List.of(), List.of(), Set.of(1L), CLOSED))).isTrue();
    assertThat(withAi(input(null, List.of(), List.of(), Set.of(1L), CLOSED.plusSeconds(1))))
        .isFalse();
  }

  @Test
  void with_ai_counts_agent_removed_before_close() {
    // 만들 때 넣은 AI 담당자는 이력 행이 없다 — 닫히기 전에 빠진 removed 만 남아도 AI와 함께
    var removedBefore = new AssigneeChange(CLOSED.minusHours(1), List.of(), List.of(9L));
    assertThat(withAi(assigneesOnly(List.of(removedBefore), Set.of()))).isTrue();
    // 닫힌 뒤 빠진 AI 는 재구성으로 닫힐 때 담당자라 (a) 로 true
    var removedAfter = new AssigneeChange(CLOSED.plusHours(1), List.of(), List.of(9L));
    assertThat(withAi(assigneesOnly(List.of(removedAfter), Set.of()))).isTrue();
  }

  // ---------------------------------------------------------------- 요약·칸

  @Test
  void summarize_nulls_when_denominator_zero() {
    var s = IssueMetricsCalculator.summarize(List.of(), 3);
    assertThat(s.completed()).isZero();
    assertThat(s.created()).isEqualTo(3);
    assertThat(s.onTimeRate()).isNull();
    assertThat(s.overdueLateDaysAvg()).isNull();
    assertThat(s.leadTimeDaysAvg()).isNull();
    assertThat(s.leadTimeDaysMedian()).isNull();
  }

  @Test
  void summarize_rates_and_late_avg() {
    LocalDate d = LocalDate.of(2026, 11, 9);
    var s =
        IssueMetricsCalculator.summarize(
            List.of(
                fact(d, DueOutcome.ON_TIME, null),
                fact(d, DueOutcome.OVERDUE, 1),
                fact(d, DueOutcome.OVERDUE, 4),
                fact(d, DueOutcome.NO_DUE, null)),
            0);
    assertThat(s.onTime()).isEqualTo(1);
    assertThat(s.overdue()).isEqualTo(2);
    assertThat(s.noDue()).isEqualTo(1);
    assertThat(s.overdueLateDaysAvg()).isEqualTo(2.5);
    assertThat(s.onTimeRate()).isEqualTo(1.0 / 3);
  }

  @Test
  void median_of_sorted_odd_even() {
    assertThat(IssueMetricsCalculator.medianOfSorted(List.of(1.0, 2.0, 3.0))).isEqualTo(2.0);
    assertThat(IssueMetricsCalculator.medianOfSorted(List.of(1.0, 2.0, 3.0, 4.0))).isEqualTo(2.5);
    assertThat(IssueMetricsCalculator.medianOfSorted(List.of())).isNull();
  }

  @Test
  void summarize_median_sorts_unsorted_lead_times() {
    LocalDate d = LocalDate.of(2026, 11, 9);
    OffsetDateTime t = d.atStartOfDay().atOffset(ZoneOffset.UTC);
    var facts =
        List.of(4.0, 1.0, 3.0).stream()
            .map(
                lead ->
                    new ClosedIssueFact(1L, 10L, t, d, null, DueOutcome.NO_DUE, null, lead, false))
            .toList();
    var s = IssueMetricsCalculator.summarize(facts, 0);
    assertThat(s.leadTimeDaysMedian()).isEqualTo(3.0);
    assertThat(s.leadTimeDaysAvg()).isEqualTo(8.0 / 3);
  }

  @Test
  void buckets_day_fills_zero() {
    var p = new MetricsPeriod(LocalDate.of(2026, 11, 3), LocalDate.of(2026, 11, 9));
    var b =
        IssueMetricsCalculator.buckets(
            p,
            MetricsGranularity.DAY,
            List.of(fact(LocalDate.of(2026, 11, 5), DueOutcome.OVERDUE, 1)),
            List.of(LocalDate.of(2026, 11, 9), LocalDate.of(2026, 10, 1)));
    assertThat(b).hasSize(7);
    assertThat(b.get(2))
        .isEqualTo(
            new MetricsBucket(LocalDate.of(2026, 11, 5), LocalDate.of(2026, 11, 5), 1, 1, 0));
    assertThat(b.get(6).created()).isEqualTo(1);
    assertThat(b.stream().mapToInt(MetricsBucket::completed).sum()).isEqualTo(1);
  }

  @Test
  void buckets_week_monday_start_clipped() {
    // 2026-11-04(수) ~ 2026-11-18(수): [11-04~11-08] [11-09~11-15] [11-16~11-18]
    var p = new MetricsPeriod(LocalDate.of(2026, 11, 4), LocalDate.of(2026, 11, 18));
    var b =
        IssueMetricsCalculator.buckets(
            p,
            MetricsGranularity.WEEK,
            List.of(
                fact(LocalDate.of(2026, 11, 8), DueOutcome.ON_TIME, null),
                fact(LocalDate.of(2026, 11, 9), DueOutcome.ON_TIME, null)),
            List.of());
    assertThat(b)
        .extracting(MetricsBucket::start, MetricsBucket::end, MetricsBucket::completed)
        .containsExactly(
            tuple(LocalDate.of(2026, 11, 4), LocalDate.of(2026, 11, 8), 1),
            tuple(LocalDate.of(2026, 11, 9), LocalDate.of(2026, 11, 15), 1),
            tuple(LocalDate.of(2026, 11, 16), LocalDate.of(2026, 11, 18), 0));
  }

  @Test
  void buckets_month_clipped() {
    var p = new MetricsPeriod(LocalDate.of(2026, 10, 15), LocalDate.of(2026, 12, 3));
    var b =
        IssueMetricsCalculator.buckets(
            p,
            MetricsGranularity.MONTH,
            List.of(
                fact(LocalDate.of(2026, 10, 31), DueOutcome.ON_TIME, null),
                fact(LocalDate.of(2026, 11, 1), DueOutcome.ON_TIME, null)),
            List.of());
    assertThat(b)
        .extracting(MetricsBucket::start, MetricsBucket::end, MetricsBucket::completed)
        .containsExactly(
            tuple(LocalDate.of(2026, 10, 15), LocalDate.of(2026, 10, 31), 1),
            tuple(LocalDate.of(2026, 11, 1), LocalDate.of(2026, 11, 30), 1),
            tuple(LocalDate.of(2026, 12, 1), LocalDate.of(2026, 12, 3), 0));
  }

  // ---------------------------------------------------------------- 후보 정규식

  @Test
  void assignee_id_pattern_tolerates_whitespace_and_cuts_digits() {
    var p = Pattern.compile(IssueMetricsRepository.assigneeIdPattern(12L));
    assertThat(p.matcher("{\"added\":[{\"id\":12,\"kind\":\"HUMAN\"}]}").find()).isTrue();
    assertThat(p.matcher("{\"added\":[{ \"id\" : 12 }]}").find()).isTrue();
    assertThat(p.matcher("{\"added\":[{\"username\":\"x\",\"id\":12}]}").find()).isTrue();
    assertThat(p.matcher("{\"added\":[{\"id\":123,\"kind\":\"HUMAN\"}]}").find()).isFalse();
    assertThat(p.matcher("{\"componentId\":12,\"added\":[]}").find()).isFalse();
  }
}
