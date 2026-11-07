package com.workplace.agentruntime;

import static com.workplace.agentruntime.dto.AgentState.BLOCKED;
import static com.workplace.agentruntime.dto.AgentState.IDLE;
import static com.workplace.agentruntime.dto.AgentState.WORKING;
import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.agentruntime.dto.AgentState;
import com.workplace.agentruntime.repository.AgentRuntimeSlotRepository.Slot;
import com.workplace.agentruntime.service.AgentSlotAggregate;
import java.time.Duration;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.List;
import org.junit.jupiter.api.Test;

/** WP-1409 — 칸(work-loop 하나)별 AI 상태 보고를 AI 하나의 상태로 합치는 규칙 단위 테스트. */
class AgentSlotAggregateTest {

  private static final OffsetDateTime T1 =
      OffsetDateTime.of(2026, 11, 6, 11, 0, 0, 0, ZoneOffset.UTC);
  private static final OffsetDateTime T2 = T1.plusHours(1);

  /** 칸 하나 — 보고 시각은 합치기에 쓰지 않으므로 고정값. */
  private static Slot slot(String key, AgentState state, String issue, OffsetDateTime next) {
    return new Slot(key, state, issue, next, T1);
  }

  /** 한 칸이라도 일하면 작업 중 — 다음 확인 시각은 쉬는 칸에서 따로 계산한다. */
  @Test
  void workingWinsOverIdle() {
    var a = agg(List.of(slot("WP", WORKING, "WP-1", null), slot("HR", IDLE, null, T1)));
    assertThat(a.state()).isEqualTo(AgentState.WORKING);
    assertThat(a.issueKeys()).containsExactly("WP-1");
    assertThat(a.latestReportedAt()).isEqualTo(T1);
    assertThat(a.nextCheckAt()).isEqualTo(T1);
  }

  /** 일하는 칸이 막힌 칸보다 먼저 — 두 이슈를 칸 키 순으로 모두 싣는다. */
  @Test
  void workingWinsOverBlocked_andKeysOrderedBySlotKey() {
    var a = agg(List.of(slot("WP", BLOCKED, "WP-9", null), slot("HR", WORKING, "HR-2", null)));
    assertThat(a.state()).isEqualTo(AgentState.WORKING);
    assertThat(a.issueKeys()).containsExactly("HR-2", "WP-9");
  }

  /** 일하는 칸이 없고 막힌 칸이 있으면 막힘. */
  @Test
  void blockedWhenNoWorking() {
    var a = agg(List.of(slot("WP", BLOCKED, "WP-9", null), slot("HR", IDLE, null, T2)));
    assertThat(a.state()).isEqualTo(AgentState.BLOCKED);
    assertThat(a.issueKeys()).containsExactly("WP-9");
    assertThat(a.nextCheckAt()).isEqualTo(T2);
  }

  /** 모든 칸이 쉴 때만 쉬는 중 — 다음 확인은 가장 이른 시각. */
  @Test
  void idleOnlyWhenAllIdle_earliestNextCheck() {
    var a =
        agg(
            List.of(
                slot("WP", IDLE, null, T2),
                slot("HR", IDLE, null, T1),
                slot("", IDLE, null, null)));
    assertThat(a.state()).isEqualTo(AgentState.IDLE);
    assertThat(a.issueKeys()).isEmpty();
    assertThat(a.nextCheckAt()).isEqualTo(T1);
  }

  /** 같은 이슈 키는 한 번만, 이슈 없는 칸은 목록에 넣지 않는다. */
  @Test
  void duplicateAndNullIssueKeysDropped() {
    var a =
        agg(
            List.of(
                slot("A", WORKING, "WP-1", null),
                slot("B", WORKING, "WP-1", null),
                slot("C", WORKING, null, null)));
    assertThat(a.state()).isEqualTo(AgentState.WORKING);
    assertThat(a.issueKeys()).containsExactly("WP-1");
  }

  /** 보고가 오래 끊긴 칸(죽은 칸)은 합치기에서 빠진다 — 7시간 전 WORKING 이 지금 IDLE 칸을 붙잡지 않는다(WP-1409). */
  @Test
  void staleSlotsAreIgnored() {
    OffsetDateTime now = T1;
    var a =
        AgentSlotAggregate.of(
            List.of(
                new Slot("HR", WORKING, "HR-2", null, now.minusHours(7)),
                new Slot("WP", IDLE, null, T2, now)),
            now,
            Duration.ofHours(6));
    assertThat(a.state()).isEqualTo(AgentState.IDLE);
    assertThat(a.issueKeys()).isEmpty();
    assertThat(a.nextCheckAt()).isEqualTo(T2);
    assertThat(a.latestReportedAt()).isEqualTo(now);

    // 경계 안(5시간 전)이면 아직 살아 있는 칸이다.
    var b =
        AgentSlotAggregate.of(
            List.of(
                new Slot("HR", WORKING, "HR-2", null, now.minusHours(5)),
                new Slot("WP", IDLE, null, T2, now)),
            now,
            Duration.ofHours(6));
    assertThat(b.state()).isEqualTo(AgentState.WORKING);
  }

  /** 칸이 없으면 모두 비어 있다(보고 없음). */
  @Test
  void emptySlots_allNull() {
    var a = agg(List.of());
    assertThat(a.state()).isNull();
    assertThat(a.issueKeys()).isEmpty();
    assertThat(a.nextCheckAt()).isNull();
    assertThat(a.latestReportedAt()).isNull();
  }

  /** 오래된 칸 거르기 없이 규칙만 보려고 아주 긴 공백을 준다. */
  private static AgentSlotAggregate agg(List<Slot> slots) {
    return AgentSlotAggregate.of(slots, T1, Duration.ofDays(3650));
  }
}
