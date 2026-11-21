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
   * 차단 칸 없이 계산하는 오버로드 — 규칙 전체는 아래 {@link #resolve(Desired, long, Long, String, String)} 가 정한다(같은
   * 판정, 차단 칸만 없음).
   */
  public static AgentRuntimeStatus resolve(
      Desired desired, long generation, Long observedGeneration, String phase) {
    return resolve(desired, generation, observedGeneration, phase, null);
  }

  /**
   * 차단 메시지를 함께 받는 오버로드(WP-1913) — 진입점이 칸을 띄우지 못한 사유는 runner 관찰 칸과 분리된 pane_blocked 칸에 저장하므로, 읽는
   * 쪽에서만 화면 상태·사유로 합친다. 판정만 읽기에서 하고 저장한 칸은 건드리지 않는다(설계 결정 5, runner 관찰 보고와 무관). 규칙은 위에서부터 처음 맞는 것:
   *
   * <ol>
   *   <li>차단 메시지가 있으면(공백 제외) FAILED — 끄는 중(드레인)에도 차단이 먼저다(설계 결정 4): 이유가 보여야 화면에서 무엇이 막혔는지 안다. 단,
   *       원하는 상태가 끄기(STOP)이고 아직 멈췄거나 관찰된 바가 없으면(3번 규칙의 OFF 조건, {@link #alreadyOff}) 물러나 아래로 넘긴다 —
   *       꺼진 뒤에도 「오류」가 영원히 남지 않게(읽기 판정, 저장한 차단 칸은 그대로 둔다)
   *   <li>phase=FAILED 이고 관찰 generation 이 현재 generation 이상 → FAILED(실패 뒤 끄기·다시 시작으로 generation 이
   *       오르면 아래 규칙으로 넘어가 STOPPING·STARTING 으로 보인다)
   *   <li>desired=STOP 이고 phase 가 없거나 STOPPED → OFF
   *   <li>desired=STOP → STOPPING(드레인 중에는 위 1번 규칙이 아직 이긴다 — 설계 결정 4)
   *   <li>관찰 generation 이 없거나 phase=STARTING → STARTING
   *   <li>관찰 generation 이 뒤처졌고 phase=RUNNING → APPLY_PENDING
   *   <li>phase=RUNNING → RUNNING
   *   <li>그 밖 → STARTING
   * </ol>
   *
   * @param paneBlockedMessage 진입점이 보고한 차단 이유 — null·공백이면 차단 없음(기존 규칙대로 계산)
   */
  public static AgentRuntimeStatus resolve(
      Desired desired,
      long generation,
      Long observedGeneration,
      String phase,
      String paneBlockedMessage) {
    if (blocked(paneBlockedMessage) && !alreadyOff(desired, phase)) {
      return AgentRuntimeStatus.FAILED;
    }
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

  /**
   * 원하는 상태가 끄기이고 아직 멈춘 상태다 — 관리자가 「끄기」를 누르고 runner 가 멈춤(또는 아직 관찰된 바 없음)을 보고한 뒤라 화면이 OFF 로 보일 자리라는
   * 뜻이다. 여기에 해당하면 차단 메시지가 있어도 FAILED 를 반환하지 않고 아래 규칙(놓치면 STOPPED 를 본다 → OFF)으로 넘긴다 — 꺼진 뒤에도 「오류」가
   * 영원히 남지 않게(WP-1913). 끄는 중(드레인)에는 해당하지 않으므로 차단이 그대로 먼저다(설계 결정 4).
   */
  private static boolean alreadyOff(Desired desired, String phase) {
    return desired == Desired.STOP && (phase == null || "STOPPED".equals(phase));
  }

  /**
   * 진입점 차단 메시지가 화면에 영향을 주는지 — null·공백이면 차단 없음(WP-1913). 상태 계산({@link #resolve})·사유 합치기(요약·상세)·백스톱 칸
   * 비움이 같은 판정을 쓰도록 한 곳에서만 정의한다 — 판정이 갈리면 공백 메시지인데 상태는 차단이 아닌 채 사유 자리만 비는 화면이 나온다.
   */
  public static boolean blocked(String paneBlockedMessage) {
    return paneBlockedMessage != null && !paneBlockedMessage.isBlank();
  }

  /**
   * 사유 자리에 싣는 메시지(WP-1913) — 진입점 차단 메시지가 있으면(공백 제외) 그 쪽을, 없으면 runner 관찰 메시지를 그대로. 요약 목록 「메시지」와 상세
   * observed.message 가 같은 공백 판정({@link #blocked})을 쓰게 한 곳에서만 정의한다 — 갈리면 공백 메시지인데 상태는 차단이 아닌 채 사유
   * 자리만 비는 화면이 나온다.
   */
  public static String reason(String paneBlockedMessage, String observedMessage) {
    return blocked(paneBlockedMessage) ? paneBlockedMessage : observedMessage;
  }
}
