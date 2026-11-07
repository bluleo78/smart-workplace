package com.workplace.agentruntime.service;

import com.workplace.agentruntime.dto.AgentState;
import com.workplace.agentruntime.repository.AgentRuntimeSlotRepository.Slot;
import java.time.Duration;
import java.time.OffsetDateTime;
import java.util.Comparator;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;

/**
 * 칸(한 Pod 안의 work-loop 하나 — 프로젝트 키)별 AI 상태 보고를 AI 하나의 상태로 합친 값(WP-1409). 한 Pod 에서 여러 프로젝트를 도는 AI 는
 * 칸마다 따로 보고하므로, 마지막 보고 하나로 AI 상태를 정하면 한 칸이 일하는 중에 다른 칸의 「쉬는 중」 보고로 Pod 가 교체될 수 있다. 그래서 칸을 모두 모아 아래
 * 규칙으로 합친다.
 *
 * <ul>
 *   <li>상태: WORKING 칸이 하나라도 있으면 WORKING · 아니면 BLOCKED 칸이 하나라도 있으면 BLOCKED · 모두 IDLE 이면 IDLE.
 *       WORKING 이 BLOCKED 보다 먼저인 까닭 — 한 칸이라도 일하고 있으면 Pod 를 갈아치우면 안 되고 화면에도 「작업 중」이 맞다. 막힌 이슈는 이슈
 *       목록에 남아 화면에서 보인다.
 *   <li>현재 이슈: WORKING·BLOCKED 칸의 이슈 키 — 칸 키 오름차순, 중복·null 제외.
 *   <li>다음 확인: IDLE 칸 중 가장 이른 next_check_at(합친 상태와 무관하게 계산).
 *   <li>오래된 칸 제외: {@link #of(List, OffsetDateTime, Duration)} 는 마지막 보고가 정해진 시간(기본 6시간 — {@code
 *       workplace.agent-runtime.slot-stale-after})보다 오래된 칸을 빼고 합친다. 칸(work-loop)은 매 턴 끝에 보고하므로 살아
 *       있는 칸의 보고는 오래 끊기지 않는다 — 사람이 칸을 죽이는 등 죽은 칸이 마지막 WORKING 으로 Pod 교체를 영영 막지 않게 한다. 행은 지우지 않는다(다시
 *       보고하면 그대로 이어진다).
 * </ul>
 *
 * <p>정렬은 여기서만 한다 — 저장소는 순서 없이 읽고(ORDER BY 없음) 이 순수 함수가 어떤 입력에도 같은 칸 키 순 결과를 낸다.
 *
 * @param state 합친 상태(살아 있는 칸이 없으면 null)
 * @param issueKeys 현재 이슈 키 목록(없으면 빈 목록) — 첫 키는 저장할 때 agent_issue_key 로도 쓴다
 * @param nextCheckAt 쉬는 칸의 가장 이른 다음 확인 시각(없으면 null)
 * @param latestReportedAt 살아 있는 칸의 가장 늦은 보고 시각(없으면 null) — agent_reported_at 으로 쓴다. 보고 흐름에서는 방금 보고한
 *     칸이라 곧 지금 시각이고, runner 정리 흐름에서는 남은 칸의 마지막 보고라 {@link RolloutPolicy} 의 「Pod 시작 전 보고」 거르기가 그대로
 *     맞는다
 */
public record AgentSlotAggregate(
    AgentState state,
    List<String> issueKeys,
    OffsetDateTime nextCheckAt,
    OffsetDateTime latestReportedAt) {

  /**
   * 오래된 칸을 뺀 뒤 합친다 — 마지막 보고가 {@code now - staleAfter} 보다 이른 칸은 죽은 칸으로 보고 합치기에서 뺀다(WP-1409).
   *
   * @param now 지금 시각
   * @param staleAfter 칸을 죽은 것으로 볼 보고 공백
   */
  public static AgentSlotAggregate of(List<Slot> slots, OffsetDateTime now, Duration staleAfter) {
    List<Slot> live = fresh(slots, now, staleAfter);
    if (live.isEmpty()) return new AgentSlotAggregate(null, List.of(), null, null);
    // 입력 순서와 무관하게 칸 키 오름차순으로 정렬한 뒤 계산한다.
    List<Slot> sorted = live.stream().sorted(Comparator.comparing(Slot::slotKey)).toList();
    boolean working = false;
    boolean blocked = false;
    Set<String> keys = new LinkedHashSet<>();
    OffsetDateTime next = null;
    OffsetDateTime latest = null;
    for (Slot s : sorted) {
      if (latest == null || s.reportedAt().isAfter(latest)) latest = s.reportedAt();
      switch (s.state()) {
        case WORKING -> working = true;
        case BLOCKED -> blocked = true;
        case IDLE -> {
          // 쉬는 칸만 다음 확인 시각을 낸다 — 가장 이른 것.
          if (s.nextCheckAt() != null && (next == null || s.nextCheckAt().isBefore(next))) {
            next = s.nextCheckAt();
          }
        }
      }
      // 일하거나 막힌 칸의 이슈만 현재 이슈다(쉬는 칸은 이슈를 비워 보고한다).
      if (s.state() != AgentState.IDLE && s.issueKey() != null) keys.add(s.issueKey());
    }
    AgentState state =
        working ? AgentState.WORKING : blocked ? AgentState.BLOCKED : AgentState.IDLE;
    return new AgentSlotAggregate(state, List.copyOf(keys), next, latest);
  }

  /** 마지막 보고가 {@code now - staleAfter} 이후인(살아 있는) 칸만. */
  private static List<Slot> fresh(List<Slot> slots, OffsetDateTime now, Duration staleAfter) {
    OffsetDateTime cutoff = now.minus(staleAfter);
    return slots.stream().filter(s -> !s.reportedAt().isBefore(cutoff)).toList();
  }
}
