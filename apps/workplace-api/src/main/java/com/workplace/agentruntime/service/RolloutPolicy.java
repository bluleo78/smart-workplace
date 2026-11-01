package com.workplace.agentruntime.service;

import com.workplace.agentruntime.dto.ApplyMode;
import com.workplace.agentruntime.repository.AgentRuntimeSettingRepository.Row;
import com.workplace.auth.dto.ManagedKeyChain;
import java.time.Duration;
import java.time.OffsetDateTime;

/**
 * 미뤄 둔 generation 을 언제 적용할지 정하는 한 규칙(WP-1249·1250·1253) — runner 의 desired {@code applyNow} 와 AI 상태
 * 보고의 RESTART·DRAIN 이 같은 판정을 쓴다. 둘이 따로 계산하면 runner 는 지금 갈아치우는데 AI 는 계속 일하라는 답을 받는 식으로 어긋난다.
 */
final class RolloutPolicy {

  /** 지금 Pod 가 그 키로 산 지 이 시간 안에 키가 만료되면, 미뤄 둔 교체를 쉴 때까지 기다리지 않고 바로 적용한다(WP-1253). */
  static final Duration POD_KEY_EXPIRY_MARGIN = Duration.ofHours(24);

  private RolloutPolicy() {}

  /** 적용 판정. */
  enum Decision {
    /** 반영하지 않은 generation 이 없다 — 할 일 없음. */
    NONE,
    /** 반영할 generation 이 있지만 AI 가 쉴 때까지 지금 Pod 를 둔다. */
    AT_IDLE,
    /** 지금 반영한다 — runner 가 Pod 를 바로 다시 만든다. */
    NOW
  }

  /**
   * 반영하지 않은 generation 이 있으면(generation ≠ observedGeneration) 다음 중 하나일 때 {@link Decision#NOW}, 아니면
   * {@link Decision#AT_IDLE}.
   *
   * <ul>
   *   <li>바로 적용(NOW)이거나 한 번도 뜬 적이 없다(관찰 generation 없음).
   *   <li>AI 가 쉬는 중(IDLE)이라고 보고했다 — 단 그 보고가 지금 Pod 가 뜨기 전에 온 것이면(agent_reported_at &lt; started_at)
   *       옛 Pod 의 보고라 믿지 않는다(WP-1253).
   *   <li>키 교체가 아직 확인되지 않았는데 지금 Pod 가 쓰는 옛 키가 {@link #POD_KEY_EXPIRY_MARGIN} 안에 만료된다(WP-1253) — 오래
   *       일하는 중이라도 죽을 키로 계속 돌지 않게.
   * </ul>
   *
   * @param keys 이 AI 의 이 워크스페이스 활성 managed 키 사슬
   */
  static Decision decide(Row row, ManagedKeyChain keys, OffsetDateTime now) {
    if (!row.hasUnappliedGeneration()) return Decision.NONE;
    if (row.applyMode() == ApplyMode.NOW || row.observedGeneration() == null) return Decision.NOW;
    if (row.isIdle() && !reportedBeforePodStart(row)) return Decision.NOW;
    if (keys.podKeyExpiresBy(row.observedGeneration(), now.plus(POD_KEY_EXPIRY_MARGIN))) {
      return Decision.NOW;
    }
    return Decision.AT_IDLE;
  }

  /** AI 상태 보고가 지금 Pod 가 뜨기 전에 온 것인지 — 두 시각이 모두 있을 때만 판단한다. */
  private static boolean reportedBeforePodStart(Row row) {
    return row.agentReportedAt() != null
        && row.startedAt() != null
        && row.agentReportedAt().isBefore(row.startedAt());
  }
}
