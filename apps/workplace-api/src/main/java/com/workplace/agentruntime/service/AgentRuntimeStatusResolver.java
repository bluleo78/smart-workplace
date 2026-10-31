package com.workplace.agentruntime.service;

import com.workplace.agentruntime.dto.AgentRuntimeStatus;
import com.workplace.agentruntime.dto.Desired;

/**
 * 원하는 상태와 관찰 상태로 화면용 실행 상태를 정하는 순수 함수(WP-1247). 저장 값만으로 계산하므로 상태 칸을 따로 두지 않는다 — runner 보고와 관리자 변경이
 * 엇갈려도 상태가 어긋나지 않게.
 */
public final class AgentRuntimeStatusResolver {

  private AgentRuntimeStatusResolver() {}

  /**
   * 규칙은 위에서부터 처음 맞는 것:
   *
   * <ol>
   *   <li>phase=FAILED 이고 관찰 generation 이 현재 generation 이상 → FAILED(실패 뒤 끄기·다시 시작으로 generation 이
   *       오르면 아래 규칙으로 넘어가 STOPPING·STARTING 으로 보인다)
   *   <li>desired=STOP 이고 phase 가 없거나 STOPPED → OFF
   *   <li>desired=STOP → STOPPING
   *   <li>관찰 generation 이 없거나 phase=STARTING → STARTING
   *   <li>관찰 generation 이 뒤처졌고 phase=RUNNING → APPLY_PENDING
   *   <li>phase=RUNNING → RUNNING
   *   <li>그 밖 → STARTING
   * </ol>
   */
  public static AgentRuntimeStatus resolve(
      Desired desired, long generation, Long observedGeneration, String phase) {
    // 실패는 지금 원하는 상태(generation)를 runner 가 반영한 뒤의 실패일 때만 보여 준다 — 옛 generation 의 실패가 새 요청을 가리지 않게.
    if ("FAILED".equals(phase) && observedGeneration != null && observedGeneration >= generation) {
      return AgentRuntimeStatus.FAILED;
    }
    if (desired == Desired.STOP) {
      return phase == null || "STOPPED".equals(phase)
          ? AgentRuntimeStatus.OFF
          : AgentRuntimeStatus.STOPPING;
    }
    if (observedGeneration == null || "STARTING".equals(phase)) return AgentRuntimeStatus.STARTING;
    if ("RUNNING".equals(phase)) {
      return observedGeneration < generation
          ? AgentRuntimeStatus.APPLY_PENDING
          : AgentRuntimeStatus.RUNNING;
    }
    return AgentRuntimeStatus.STARTING;
  }
}
