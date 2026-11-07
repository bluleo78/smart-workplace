package com.workplace.agentruntime.repository;

import com.workplace.agentruntime.repository.AgentRuntimeSettingRepository.Row;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.util.List;

/**
 * 관리자 화면에 보이는 AI 실행 상태 묶음(WP-1254) — runner 관찰 보고·AI 상태 보고 전후로 이 값이 달라졌을 때만 실시간 변경을 알린다. 쓰기 문장이 쓰기
 * 전 값을 이 모양으로 돌려주고, 호출자가 쓴 뒤 행의 값({@link #of})과 견준다.
 *
 * <p>화면 상태(OFF·RUNNING …)는 넣지 않는다 — 원하는 상태·generation(보고가 바꾸지 않는다)과 여기 있는 관찰 generation·phase 로
 * 정해지므로 이 값들이 같으면 상태도 같다. CPU·메모리·관찰 시각도 넣지 않는다 — 보고(약 60초)마다 바뀌어 넣으면 보고마다 알림이 나간다. 시각은 {@link
 * Instant} 로 견준다 — 같은 순간이 오프셋만 달라 다르게 보이지 않게. 현재 이슈 키 목록(WP-1409)도 화면에 보이므로 넣는다.
 */
public record VisibleRuntimeState(
    Long observedGeneration,
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
