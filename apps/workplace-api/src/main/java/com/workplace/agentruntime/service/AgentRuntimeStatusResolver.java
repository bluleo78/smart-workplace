package com.workplace.agentruntime.service;

import com.workplace.agentruntime.dto.AgentRuntimeStatus;
import com.workplace.agentruntime.dto.ApplyMode;
import com.workplace.agentruntime.dto.Desired;
import com.workplace.agentruntime.repository.AgentRuntimeSettingRepository.Row;
import com.workplace.agentruntime.repository.AgentRuntimeSlotRepository;
import java.time.OffsetDateTime;

/**
 * 원하는 상태와 관찰 상태로 화면용 실행 상태를 정하는 순수 함수(WP-1247). 저장 값만으로 계산하므로 상태 칸을 따로 두지 않는다 — runner 보고와 관리자 변경이
 * 엇갈려도 상태가 어긋나지 않게.
 */
public final class AgentRuntimeStatusResolver {

  private AgentRuntimeStatusResolver() {}

  /**
   * 차단 칸·미룬 실패 없이 계산하는 오버로드 — 규칙 전체는 아래 {@link #resolve(Desired, long, Long, Long, String, String,
   * boolean)} 가 정한다(같은 판정, 차단 칸·미룬 실패만 없음).
   */
  public static AgentRuntimeStatus resolve(
      Desired desired, long generation, Long observedGeneration, String phase) {
    return resolve(desired, generation, observedGeneration, phase, null, false);
  }

  /**
   * 실패 generation 없이 계산하는 오버로드 — 옛 호출·테스트용. 규칙은 아래 7인자 {@link #resolve(Desired, long, Long, Long,
   * String, String, boolean)} 가 정한다(failedGeneration=null).
   */
  public static AgentRuntimeStatus resolve(
      Desired desired,
      long generation,
      Long observedGeneration,
      String phase,
      String paneBlockedMessage,
      boolean failureHeldUntilIdle) {
    return resolve(
        desired,
        generation,
        observedGeneration,
        null,
        phase,
        paneBlockedMessage,
        failureHeldUntilIdle);
  }

  /**
   * 차단 메시지·실패 generation 을 함께 받는 판정(WP-1913·WP-2019) — 진입점이 칸을 띄우지 못한 사유는 runner 관찰 칸과 분리된
   * pane_blocked 칸에 저장하므로, 읽는 쪽에서만 화면 상태·사유로 합친다. 판정만 읽기에서 하고 저장한 칸은 건드리지 않는다(설계 결정 5, runner 관찰
   * 보고와 무관). 규칙은 위에서부터 처음 맞는 것:
   *
   * <ol>
   *   <li>차단 메시지가 있으면(공백 제외) FAILED — 끄는 중(드레인)에도 차단이 먼저다(설계 결정 4): 이유가 보여야 화면에서 무엇이 막혔는지 안다. 단,
   *       원하는 상태가 끄기(STOP)이고 아직 멈췄거나 관찰된 바가 없으면(3번 규칙의 OFF 조건, {@link #alreadyOff}) 물러나 아래로 넘긴다 —
   *       꺼진 뒤에도 「오류」가 영원히 남지 않게(읽기 판정, 저장한 차단 칸은 그대로 둔다)
   *   <li>phase=FAILED 이고 (관찰 generation 이 있으며 현재 generation 이상, 또는 runner 가 보고한 실패 generation 이 현재
   *       generation 이상) → FAILED(실패 뒤 끄기·다시 시작으로 generation 이 오르면 아래 규칙으로 넘어가 STOPPING·STARTING 으로
   *       보인다). 실패 generation 은 옛 Pod 가 남아 관찰 generation 이 뒤처져도 새 설정 실패를 알리는 칸이다(WP-2019 — 관찰
   *       generation 이 없어도 된다). 관찰 generation 이 뒤처졌어도 {@code failureHeldUntilIdle} 이면(하던 일이 있어 새
   *       설정을 쉴 때로 미룬 실패, WP-2000) FAILED 로 둔다 — 아직 새 설정으로 다시 뜨는 중이 아니라서
   *   <li>desired=STOP 이고 phase 가 없거나 STOPPED → OFF
   *   <li>desired=STOP → STOPPING(드레인 중에는 위 1번 규칙이 아직 이긴다 — 설계 결정 4)
   *   <li>관찰 generation 이 없거나 phase=STARTING → STARTING
   *   <li>관찰 generation 이 뒤처졌고 phase=RUNNING → APPLY_PENDING
   *   <li>phase=RUNNING → RUNNING
   *   <li>그 밖 → STARTING
   * </ol>
   *
   * @param failedGeneration runner 가 보고한 실패가 난 desired generation — null 이면 기록 없음(옛 runner 포함)
   * @param paneBlockedMessage 진입점이 보고한 차단 이유 — null·공백이면 차단 없음(기존 규칙대로 계산)
   * @param failureHeldUntilIdle 서버 판정({@code RolloutPolicy.pending})이 「쉴 때 적용」이라 옛 generation 의 실패가
   *     그대로 남아 있는 경우 — 판정은 호출자가 한 곳에서 내려 넘기고 여기서는 다시 계산하지 않는다
   */
  public static AgentRuntimeStatus resolve(
      Desired desired,
      long generation,
      Long observedGeneration,
      Long failedGeneration,
      String phase,
      String paneBlockedMessage,
      boolean failureHeldUntilIdle) {
    if (blocked(paneBlockedMessage) && !alreadyOff(desired, phase)) {
      return AgentRuntimeStatus.FAILED;
    }
    // 실패는 지금 원하는 상태(generation)를 runner 가 반영한 뒤의 실패일 때만 보여 준다 — 옛 generation 의 실패가 새 요청을 가리지 않게.
    // 단 새 설정을 쉴 때로 미뤘다면(failureHeldUntilIdle) 옛 실패를 그대로 보여 준다 — 새로 뜨는 중이 아니다(WP-2000).
    // 새 설정의 실패는 옛 Pod 가 남아 observedGeneration 이 뒤처져도 failedGeneration 으로 보인다(WP-2019).
    if ("FAILED".equals(phase)
        && ((observedGeneration != null
                && (observedGeneration >= generation || failureHeldUntilIdle))
            || (failedGeneration != null && failedGeneration >= generation))) {
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
   * 지금 Pod 의 차단 사유인지 — 저장 행({@link Row})에서 지금 반영할 차단 사유를 고른다. 읽는 셋(목록·상세·화면 중계)이 한 판정을 쓰게 여기만
   * 정의한다(WP-1913 리뷰 반려 ①).
   *
   * <p>차단 generation 은 저장할 때 보고한 값 그대로인데(WP-1969) 화면 판정이 설정 generation 만 견주면, 「쉴 때 적용」 대기 중 설정이 오르는
   * 동안 지금 도는 Pod(관찰 generation)의 BLOCKED 가 204 로 받아지고도 「오류」가 안 뜬다(WP-1968 5차 반려 ③). 그래서 **쉴 때 적용 대기
   * 중에만** 저장한 차단이 지금 도는 Pod 의 것(관찰 generation)이면 그 generation 으로 견준다 — 실패를 감추면 관리자가 시작 실패 사유를 보지
   * 못한다. 즉시 적용(NOW)에서는 관찰이 뒤처진 동안만 옛 Pod 차단을 보여 주게 설정 generation 으로 견준다(6차 반려 ②) — 다음 관찰까지 옛 Pod 의
   * 차단이 「오류」로 남던 WP-1913 회귀를 되돌린다. 그 밖(앞 세대 옛 Pod · 관찰 전)은 지금 설정 generation 으로 견주어 옛 사유를 그대로 가린다.
   *
   * <p>가르는 기준은 설정의 {@code apply_mode} 열이다 — {@code RolloutPolicy} 의 유효 판정(일이 없거나 관찰이 없는 동안은 NOW 로
   * 넓어지는 값)이 아니라. 열과 함께 갈리면 「하던 일 때문에 적용을 쉴 때로 미룬」 상태에서도 옛 사유가 감춰져 WP-2000 이 무너지고(파생: {@code
   * get_whenBlockedRunningPodAndNoWork_pendingNowAndFailed}), 반대로 열이 늘 NOW 면 관찰이 뒤처진 한 관찰 주기 동안 옛
   * Pod 차단이 「오류」로 남아 WP-1913 회귀가 되살아난다(6차 반려 ② — 게이트를 잠그는 대조 테스트는 {@code
   * AgentRuntimeAdminViewApiTest#paneBlocked_observedBehind_showsErrorOnlyWhileIdleApply}).
   */
  public static String currentPaneBlocked(Row r) {
    return currentPaneBlocked(
        r.paneBlockedMessage(),
        r.paneBlockedGeneration(),
        expectedPaneBlockGeneration(
            r.paneBlockedGeneration(),
            r.generation(),
            r.observedGeneration(),
            r.applyMode() != ApplyMode.NOW),
        r.paneBlockedAt(),
        r.startedAt(),
        r.paneBlockedPodStartedAt(),
        r.reportedPodStartedAt());
  }

  /**
   * 화면이 견줄 차단 generation(WP-1968 5차 반려 ③·6차 반려 ②) — 차단 저장은 늘 보고한 generation 그대로인데(WP-1969) 화면 판정이
   * 설정 generation 만 견주면, 「쉴 때 적용」 대기 중 설정이 오르는 동안 지금 도는 Pod(관찰 generation)의 BLOCKED 가 204 로 받아지고도
   * 「오류」가 안 뜬다. 그래서 쉴 때 적용 대기 중에만(atIdleApply) 저장한 차단이 지금 도는 Pod 의 것(관찰 generation)이면 그 generation
   * 으로 견준다 — 실패를 감추면 관리자가 시작 실패 사유를 보지 못한다. 즉시 적용(NOW)에서는 관찰 generation 을 견주지 않고 설정 generation 으로만
   * 가린다(6차 반려 ②) — 관찰이 뒤처진 동안(다음 관찰까지) 옛 Pod 의 차단이 「오류」로 남던 WP-1913 회귀를 되돌린다. 그 밖(앞 세대 옛 Pod · 관찰
   * 전)은 지금 설정 generation 으로 견주어 옛 사유를 그대로 가린다. 저장 원문은 건드리지 않고 읽는 판정만 넓힌다.
   *
   * @param storedGeneration 저장한 차단의 generation — null(모르는 값)은 아래 규칙도 못 박는다(그대로 믿는다)
   * @param generation 지금 설정 generation
   * @param observedGeneration 지금 도는 Pod 의 관찰 generation — null(관찰 전)이면 설정 generation 쪽
   * @param atIdleApply 지금 「쉴 때 적용」 대기 중인지 — 지금 적용(NOW)이면 관찰 generation 을 견주지 않는다
   * @return 화면이 견줄 generation
   */
  public static long expectedPaneBlockGeneration(
      Long storedGeneration, long generation, Long observedGeneration, boolean atIdleApply) {
    if (atIdleApply
        && observedGeneration != null
        && storedGeneration != null
        && storedGeneration.longValue() == observedGeneration.longValue()) {
      return observedGeneration;
    }
    return generation;
  }

  /**
   * 지금 반영할 진입점 차단 사유(WP-1913·WP-1958) — 저장한 사유가 지금 generation 에서 보고한 것일 때, 그리고 지금 Pod 가 뜬 뒤에 남은 것일
   * 때만 읽는다. 설정을 고쳐 새 generation 이 뜨거나 재시작해 새 Pod 가 뜨면 옛 사유가 「오류」로 남지 않고, 끝나는 중인 옛 Pod 가 늦게 보고한 사유도
   * 가려진다. 빈 자리(모르는 값)는 그대로 믿는다.
   *
   * <p>시각 비교에는 {@link AgentRuntimeSlotRepository#podStartCutoff} 여유(WP-1253 과 같은 30초)를 쓴다 — {@code
   * blockedAt} 은 API 서버 시계, {@code startedAt} 은 runner·kubelet 시계라 조금 어긋나므로 시작 시각보다 30초 넘게 앞선 차단만 옛
   * Pod 의 것으로 본다. 차단한 Pod 의 시작 시각이 지금 Pod 시작({@link AgentRuntimeSlotRepository#currentPodStart} —
   * 관찰값과 보고값 중 늦은 쪽)보다 30초 넘게 앞서도 가린다.
   *
   * @param message 저장한 차단 이유 — null·공백이면 차단 없음
   * @param messageGeneration 그 사유를 보고한 Pod 의 generation — null(모르는 값)은 지금 것을 본다
   * @param generation 지금 원하는 generation
   * @param blockedAt 차단을 보고한 시각 — null(모르는 값)은 견주지 않는다
   * @param startedAt 지금 Pod 가 뜬 시각 — null(관찰 전)은 견주지 않는다
   * @param paneBlockedPodStartedAt 차단을 보고한 Pod 의 시작 시각 — null(모르는 값)은 견주지 않는다
   * @param reportedPodStartedAt 칸 보고가 올려 둔 Pod 시작 시각 — null 이면 관찰값만 쓴다
   * @return 화면에 합칠 차단 사유, 합치지 않을 때(차단 없음·옛 사유)는 null
   */
  public static String currentPaneBlocked(
      String message,
      Long messageGeneration,
      long generation,
      OffsetDateTime blockedAt,
      OffsetDateTime startedAt,
      OffsetDateTime paneBlockedPodStartedAt,
      OffsetDateTime reportedPodStartedAt) {
    return paneBlockFresh(
            message,
            messageGeneration,
            generation,
            blockedAt,
            startedAt,
            paneBlockedPodStartedAt,
            reportedPodStartedAt)
        ? message
        : null;
  }

  /**
   * 지금 도는 Pod 의 컨테이너가 시작에 실패했는지(WP-1969).
   *
   * <p>화면용 {@link #currentPaneBlocked(Row)} 는 쉴 때 적용 대기 중에만 관찰 generation 으로 견주어 지금 도는 Pod 의 차단을 보여
   * 주고(5차 반려 ③), 그 밖(즉시 적용·앞 세대 옛 Pod)에는 원하는 generation 과 견준다(6차 반려 ②). 이 메서드는 표시와 달리 적용 판정용이라 같은
   * 신선도 규칙을 늘 관찰 generation 으로 적용한다. 화면과 달리 차단 generation 을 모르는 값(null — 옛 플러그인)은 어느 Pod 의 것인지 알 수
   * 없어 믿지 않는다 — 잘못 믿으면 일하는 AI 를 다시 띄운다. 관찰 generation 을 모르면(뜬 적 없음) false 다.
   */
  public static boolean blocksRunningPod(Row r) {
    if (r.observedGeneration() == null || r.paneBlockedGeneration() == null) return false;
    return paneBlockFresh(
        r.paneBlockedMessage(),
        r.paneBlockedGeneration(),
        r.observedGeneration(),
        r.paneBlockedAt(),
        r.startedAt(),
        r.paneBlockedPodStartedAt(),
        r.reportedPodStartedAt());
  }

  /**
   * 저장한 차단이 {@code expectedGeneration} 의 지금 Pod 것이라 믿을 수 있는지 — 두 읽기({@link
   * #currentPaneBlocked}·{@link #blocksRunningPod})가 견주는 generation 만 달리하고 나머지 신선도 규칙은 이 한 곳을 쓴다.
   */
  private static boolean paneBlockFresh(
      String message,
      Long messageGeneration,
      long expectedGeneration,
      OffsetDateTime blockedAt,
      OffsetDateTime startedAt,
      OffsetDateTime paneBlockedPodStartedAt,
      OffsetDateTime reportedPodStartedAt) {
    if (!blocked(message)) return false;
    if (messageGeneration != null && messageGeneration != expectedGeneration) return false;
    if (AgentRuntimeSlotRepository.isOlderPod(blockedAt, startedAt)) return false;
    // 차단한 Pod 가 지금 Pod 보다 앞선 Pod 면(재시작 전 Pod 의 차단) 가린다 — 시각은 서버 시계가 아니라 Pod 가 직접 보고한 값이다.
    OffsetDateTime current =
        AgentRuntimeSlotRepository.currentPodStart(startedAt, reportedPodStartedAt);
    return !AgentRuntimeSlotRepository.isOlderPod(paneBlockedPodStartedAt, current);
  }

  /**
   * 진입점 차단 메시지가 화면에 영향을 주는지 — null·공백이면 차단 없음(WP-1913). 상태 계산({@link #resolve})·사유 합치기(요약·상세)·백스톱 칸
   * 비움이 같은 판정을 쓰도록 한 곳에서만 정의한다 — 판정이 갈리면 공백 메시지인데 상태는 차단이 아닌 채 사유 자리만 비는 화면이 나온다.
   *
   * <p>지금 Pod 의 것인지({@link #currentPaneBlocked})까지 따진 값에만 쓴다 — 저장한 값 그대로 쓰면 옛 generation 의 사유가 다시
   * 살아난다.
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
