package com.workplace.agentruntime.service;

import com.workplace.agentruntime.dto.ApplyMode;
import com.workplace.agentruntime.dto.Desired;
import com.workplace.agentruntime.repository.AgentRuntimeSettingRepository.Row;
import com.workplace.agentruntime.repository.AgentRuntimeSlotRepository;
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
   *   <li>지금 Pod 의 컨테이너가 시작에 실패했다고 보고했는데({@link AgentRuntimeStatusResolver#blocksRunningPod}) 진행 중인
   *       일이 없다({@link #noWorkInProgress}) — 시작도 못 한 컨테이너는 IDLE 을 보고할 수 없어 기다리면 미뤄 둔 설정이 영영 나가지
   *       않는다(WP-1969).
   *   <li>지금 Pod 가 시작에 실패했다고 runner 가 관찰했고(phase=FAILED, 차단 메시지 없이도) 진행 중인 일이 없다 — 마찬가지로 기다리면 영영 안
   *       나간다(WP-2000). 일이 있으면 끊지 않고 쉴 때까지 둔다. 일이 없는지는 지금 Pod 시작 시각 기준이다. 단 AI 상태 보고가 {@code
   *       slotStaleAfter} 보다 오래됐으면 일이 없는 것으로 본다({@link #workReportExpired}) — 일하다 같은 Pod 로 실패한 경우.
   *   <li>키 교체가 아직 확인되지 않았는데 지금 Pod 가 쓰는 옛 키가 {@link #POD_KEY_EXPIRY_MARGIN} 안에 만료된다(WP-1253) — 오래
   *       일하는 중이라도 죽을 키로 계속 돌지 않게.
   * </ul>
   *
   * @param keys 이 AI 의 이 워크스페이스 활성 managed 키 사슬
   * @param slotStaleAfter 일하는 칸의 보고가 이 시간 넘게 없으면 낡은 것으로 본다(설정 slot-stale-after)
   */
  static Decision decide(
      Row row, ManagedKeyChain keys, OffsetDateTime now, Duration slotStaleAfter) {
    if (!row.hasUnappliedGeneration()) return Decision.NONE;
    if (row.applyMode() == ApplyMode.NOW || row.observedGeneration() == null) return Decision.NOW;
    if (row.isIdle() && !reportedBeforePodStart(row)) return Decision.NOW;
    if (AgentRuntimeStatusResolver.blocksRunningPod(row)
        && noWorkInProgress(row, blockingPodUid(row), row.paneBlockedPodStartedAt())) {
      return Decision.NOW;
    }
    // runner 가 관찰한 시작 실패(WP-2000) — 기준 Pod 는 차단 기록이 없으니 지금 Pod 의 시작 시각이다.
    // 일하던 Pod 가 같은 Pod 로 실패(CrashLoop)하면 칸을 다시 합치지 않아 저장 상태가 WORKING 으로 남는다 — 일하는 컨테이너는 턴마다
    // 보고하므로 보고가 오래되면(workReportExpired) 일이 없는 것으로 본다.
    if ("FAILED".equals(row.phase())
        && (noWorkInProgress(
                row,
                row.observedPodUid(),
                AgentRuntimeSlotRepository.currentPodStart(
                    row.startedAt(), row.reportedPodStartedAt()))
            || workReportExpired(row, now, slotStaleAfter))) {
      return Decision.NOW;
    }
    if (keys.podKeyExpiresBy(row.observedGeneration(), now.plus(POD_KEY_EXPIRY_MARGIN))) {
      return Decision.NOW;
    }
    return Decision.AT_IDLE;
  }

  /**
   * 화면에 보일 적용 시점(WP-2000) — 꺼져 있으면(desired≠RUN) Pod 에 닿을 설정이 없어 {@link Decision#NONE}, 아니면 {@link
   * #decide} 그대로. 상세·목록이 따로 규칙을 두지 않고 이 한 곳을 읽는다.
   *
   * <p>다만 화면에 보이는 진입점 차단이 원하는 generation 의 것이면 NONE 이다 — 새 설정으로 다시 뜬 Pod 가 막힌 것이라 이미 적용된 설정의 실패다.
   * runner 관찰은 최대 한 분 늦어 observed_generation 은 아직 옛 것이지만, 그때 「쉴 때 적용」이나 「지금 적용」을 권하면 눌러도 runner 는
   * 같은 generation 이라 아무것도 하지 않는다. {@link #decide}(runner 를 깨울지)는 이 예외 없이 그대로다.
   *
   * <p>runner 가 지금 generation 을 반영하다 실패했다고 보고했을 때({@code failedGeneration >= generation}, WP-2019)도
   * NONE 이다 — 위 진입점 차단과 같은 까닭으로, runner 가 이미 이 generation 을 시도해 실패했으니 「쉴 때 적용」·「지금 적용」 안내를 「오류」와 함께
   * 보이지 않는다. {@link #decide} 는 이 예외 없이 그대로다.
   *
   * <p>또 Pod 를 만들지 못한 실패({@link #podCreateFailed})는 {@link #decide} 가 쉴 때까지 두라고 해도 화면에는 지금 적용으로 보인다
   * — runner 는 Pod 가 없으면 applyNow 와 상관없이 지금 desired 로 만들어 보기 때문이다(runner {@code plan.ts} 의 {@code
   * !pod → create}). 「쉴 때 적용」이라 안내하면 일이 있어 보여도 실제로는 곧 새 설정으로 뜬다. {@link #decide} 는 관찰이 낡은 사이 새 Pod
   * 가 일하면 끊지 않으려고 이 경우도 넓히지 않는다.
   */
  static Decision pending(
      Row row, ManagedKeyChain keys, OffsetDateTime now, Duration slotStaleAfter) {
    if (row.desired() != Desired.RUN) return Decision.NONE;
    if (AgentRuntimeStatusResolver.currentPaneBlocked(row) != null
        && row.paneBlockedGeneration() != null
        && row.paneBlockedGeneration() == row.generation()) {
      return Decision.NONE;
    }
    if (row.failedGeneration() != null && row.failedGeneration() >= row.generation()) {
      return Decision.NONE;
    }
    Decision decision = decide(row, keys, now, slotStaleAfter);
    return decision == Decision.AT_IDLE && podCreateFailed(row) ? Decision.NOW : decision;
  }

  /**
   * Pod 를 만들지 못해 실패한 상태인지(WP-2000) — runner 가 만들기에 실패하면 phase=FAILED 에 시작 시각(startedAt)이 없다(Pod 가
   * 없다). Pod 가 없으면 runner 는 applyNow 와 상관없이 지금 desired 로 만들므로, 화면은 이때를 쉴 때로 미룬 것으로 안내하지 않는다. 실패 사유
   * 문자열은 해석하지 않는다.
   */
  static boolean podCreateFailed(Row row) {
    return "FAILED".equals(row.phase()) && row.startedAt() == null;
  }

  /**
   * 보고 전후로 runner 판정({@link #decide})이 지금 적용으로 막 바뀌었는지 — 세 보고 경로가 runner 를 깨우는 한 기준(WP-2000). 「전」은
   * 직전 상태가 판정되던 시각({@code beforeAt}), 「후」는 지금({@code now})으로 판정해, 시간만으로 바뀐 판정(키 만료 여유·오래된 보고 상한)도
   * 잡는다.
   */
  static boolean becameNow(
      Row before,
      OffsetDateTime beforeAt,
      Row after,
      ManagedKeyChain keys,
      OffsetDateTime now,
      Duration slotStaleAfter) {
    return decide(before, keys, beforeAt, slotStaleAfter) != Decision.NOW
        && decide(after, keys, now, slotStaleAfter) == Decision.NOW;
  }

  /**
   * {@link #becameNow(Row, OffsetDateTime, Row, ManagedKeyChain, OffsetDateTime, Duration)} — 보고
   * 경로는 전후를 같은 시각으로 본다.
   */
  static boolean becameNow(
      Row before, Row after, ManagedKeyChain keys, OffsetDateTime now, Duration slotStaleAfter) {
    return becameNow(before, now, after, keys, now, slotStaleAfter);
  }

  /**
   * 보고 전후로 화면 판정({@link #pending})이 바뀌었는지 — 「전」은 {@code beforeAt}, 「후」는 {@code now} 시각으로
   * 판정한다(WP-2000).
   */
  static boolean pendingChanged(
      Row before,
      OffsetDateTime beforeAt,
      Row after,
      ManagedKeyChain keys,
      OffsetDateTime now,
      Duration slotStaleAfter) {
    return pending(before, keys, beforeAt, slotStaleAfter)
        != pending(after, keys, now, slotStaleAfter);
  }

  /**
   * {@link #pendingChanged(Row, OffsetDateTime, Row, ManagedKeyChain, OffsetDateTime, Duration)} —
   * 보고 경로는 전후를 같은 시각으로 본다.
   */
  static boolean pendingChanged(
      Row before, Row after, ManagedKeyChain keys, OffsetDateTime now, Duration slotStaleAfter) {
    return pendingChanged(before, now, after, keys, now, slotStaleAfter);
  }

  /**
   * 사람이 화면에서 계정을 바꾸면 그 변경이 지금 적용되는지(WP-2000) — 꺼져 있으면 Pod 가 없어 기다릴 것이 없으므로 참(다시 시작되는 Pod 는 없고 다음 시작
   * 때 새 값으로 뜬다). 켜져 있으면 실제 변경 경로({@code bumpGenerationForRotation} — generation+1, 걸려 있는 바로
   * 적용(NOW)은 지키고 아니면 IDLE)와 같은 식으로 행을 만들어 {@link #decide} 에 묻는다.
   */
  static boolean accountChangeAppliesNow(
      Row row, ManagedKeyChain keys, OffsetDateTime now, Duration slotStaleAfter) {
    if (row.desired() != Desired.RUN) return true;
    // Pod 가 없는 실패는 runner 가 바로 새 설정으로 만든다(pending 과 같은 이유).
    if (podCreateFailed(row)) return true;
    ApplyMode mode =
        row.applyMode() == ApplyMode.NOW && row.hasUnappliedGeneration()
            ? ApplyMode.NOW
            : ApplyMode.IDLE;
    Row after = row.withGeneration(row.generation() + 1).withApplyMode(mode);
    return decide(after, keys, now, slotStaleAfter) == Decision.NOW;
  }

  /**
   * 진행 중인 일이 없는지(WP-1969·WP-2000). WORKING·BLOCKED 는 같은 컨테이너의 다른 칸이 일하는 중일 수 있어 거짓이다. 상태는 칸이 모두
   * 오래돼도 비는데 그때는 일하는 중일 수 있다 — 일하던 칸의 마지막 보고 시각은 남으므로({@link AgentSlotAggregate}) 그것이 차단한 Pod 가 뜨기
   * 전 것일 때만 참이다. 남은 시각이 있는데 기준 Pod 의 시작 시각을 모르면 가를 수 없어 거짓이다.
   *
   * <p>마지막 상태 보고가 기준 Pod 것이 아닌지는 칸 거르기와 같은 규칙({@link AgentRuntimeSlotRepository#isOldPodReport})으로
   * 가른다(WP-2010). 보고 칸의 Pod 정체·시작 시각(agent_reported_pod_uid·agent_reported_pod_started_at)을 기준 Pod
   * 와 견주고, 시각 없는 보고의 기준도 기준 Pod 의 시작 시각이다.
   *
   * @param podUid 기준 Pod 의 정체(uid) — 차단 규칙은 차단한 Pod, 시작 실패 규칙은 지금 Pod. 모르면 null
   * @param podStart 기준 Pod 의 시작 시각 — 차단 규칙은 차단한 Pod, 시작 실패 규칙은 지금 Pod. 모르면 null
   */
  private static boolean noWorkInProgress(Row row, String podUid, OffsetDateTime podStart) {
    if (row.agentState() != null) return row.isIdle();
    return row.agentReportedAt() == null
        || AgentRuntimeSlotRepository.isOldPodReport(
            row.agentReportedPodUid(),
            row.agentReportedPodStartedAt(),
            row.agentReportedAt(),
            podUid,
            podStart);
  }

  /**
   * 차단 규칙의 기준 Pod 정체(WP-2010 R3) — 차단을 기록한 Pod 가 관찰한 지금 Pod 일 때만 그 정체를 쓰고, 아니면(다르거나 하나라도 모름) null 로
   * 시각 규칙에 맡긴다. 차단 기록 Pod 가 지금 Pod 가 아닌데 정체로 견주면, 그보다 새 Pod 의 상태 보고가 정체 불일치로 옛 것이 되어 일하는 중인데도 지금
   * 적용될 수 있다.
   */
  private static String blockingPodUid(Row row) {
    String blocked = AgentRuntimeSlotRepository.nullIfNoIdentity(row.paneBlockedPodUid());
    return blocked != null && blocked.equals(row.observedPodUid()) ? blocked : null;
  }

  /**
   * AI 상태 보고가 {@code staleAfter} 보다 오래됐는지(WP-2000) — 시작 실패(FAILED) 규칙의 상한. 일하던 Pod 가 같은 Pod 로 실패하면
   * 칸을 다시 합치지 않아 저장 상태가 WORKING 으로 남지만, 일하는 컨테이너는 턴마다 보고해 이 시각이 새롭다. 오래 조용하면 일이 끝났거나 죽은 것이다. 차단
   * 규칙에는 쓰지 않는다.
   */
  private static boolean workReportExpired(Row row, OffsetDateTime now, Duration staleAfter) {
    return row.agentReportedAt() != null
        && AgentSlotAggregate.isStale(row.agentReportedAt(), now, staleAfter);
  }

  /** AI 상태 보고가 지금 Pod 가 뜨기 전에 온 것인지 — 두 시각이 모두 있을 때만 판단한다. */
  private static boolean reportedBeforePodStart(Row row) {
    return row.agentReportedAt() != null
        && row.startedAt() != null
        && row.agentReportedAt().isBefore(row.startedAt());
  }
}
