package com.workplace.agentruntime.repository;

import com.workplace.agentruntime.repository.AgentRuntimeSettingRepository.Row;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.util.List;

/**
 * 관리자 화면에 보이는 AI 실행 상태 묶음(WP-1254) — runner 관찰 보고·AI 상태 보고 전후로 이 값이 달라졌을 때 실시간 변경을 알린다. 쓰기 문장이 쓰기 전
 * 행을 돌려주고, 호출자가 그 행과 쓴 뒤 행을 각각 이 모양({@link #of})으로 바꿔 견준다.
 *
 * <p>화면 상태(OFF·RUNNING …)는 넣지 않는다 — 원하는 상태·generation(보고가 바꾸지 않는다)과 여기 있는 관찰 generation·실패
 * generation(WP-2019)·phase 로 거의 정해진다. 다만 시작 실패(FAILED)의 화면 상태는 적용 판정({@code RolloutPolicy})에도 달려
 * 있어 이 값이 같아도 바뀔 수 있다(WP-2000) — 호출자가 판정 전후를 따로 견주어 알린다. CPU·메모리·관찰 시각도 넣지 않는다 — 보고(약 60초)마다 바뀌어
 * 넣으면 보고마다 알림이 나간다. 시각은 {@link Instant} 로 견준다 — 같은 순간이 오프셋만 달라 다르게 보이지 않게. 현재 이슈 키 목록(WP-1409)도 화면에
 * 보이므로 넣는다.
 */
public record VisibleRuntimeState(
    Long observedGeneration,
    Long failedGeneration,
    String phase,
    String observedMessage,
    Instant startedAt,
    String agentState,
    String agentIssueKey,
    List<String> agentIssueKeys,
    Instant agentNextCheckAt) {

  /** 저장 행에서 화면에 보이는 값만 뽑는다. */
  public static VisibleRuntimeState of(Row r) {
    return new VisibleRuntimeState(
        r.observedGeneration(),
        r.failedGeneration(),
        r.phase(),
        r.observedMessage(),
        instant(r.startedAt()),
        r.agentState(),
        r.agentIssueKey(),
        r.agentIssueKeys(),
        instant(r.agentNextCheckAt()));
  }

  /** 이 값이 쓴 뒤 행과 다른지 — 화면에 보이는 것이 바뀌었는지. */
  public boolean differsFrom(Row after) {
    return !equals(of(after));
  }

  /** 시각을 순간으로 — 오프셋만 다른 같은 순간을 같게 견주려고(null 은 null). */
  public static Instant instant(OffsetDateTime t) {
    return t == null ? null : t.toInstant();
  }
}
