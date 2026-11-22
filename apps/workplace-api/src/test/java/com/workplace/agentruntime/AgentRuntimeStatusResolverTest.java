package com.workplace.agentruntime;

import static com.workplace.agentruntime.dto.Desired.RUN;
import static com.workplace.agentruntime.dto.Desired.STOP;
import static com.workplace.agentruntime.service.AgentRuntimeStatusResolver.currentPaneBlocked;
import static com.workplace.agentruntime.service.AgentRuntimeStatusResolver.resolve;
import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.agentruntime.dto.AgentRuntimeStatus;
import org.junit.jupiter.api.Test;

/** WP-1247 — 원하는 상태·관찰 상태로 화면 상태를 정하는 규칙(위에서부터 처음 맞는 것) 단위 테스트. */
class AgentRuntimeStatusResolverTest {

  /** 최신 generation 을 반영한 관찰이 FAILED 면 FAILED. */
  @Test
  void resolve_whenFailedAtCurrentGeneration_returnsFailed() {
    assertThat(resolve(RUN, 3, 3L, "FAILED")).isEqualTo(AgentRuntimeStatus.FAILED);
  }

  /** 실패 뒤 끄기를 누르면(관찰 generation 이 뒤처짐) FAILED 가 아니라 끄는 중으로 보인다. */
  @Test
  void resolve_whenStopRequestedAfterFailure_returnsStopping() {
    assertThat(resolve(STOP, 4, 3L, "FAILED")).isEqualTo(AgentRuntimeStatus.STOPPING);
  }

  /** 실패 뒤 runner 가 멈춤을 보고하면 OFF. */
  @Test
  void resolve_whenStoppedAfterFailure_returnsOff() {
    assertThat(resolve(STOP, 4, 4L, "STOPPED")).isEqualTo(AgentRuntimeStatus.OFF);
  }

  /** 실패 뒤 다시 시작하면(관찰 generation 이 뒤처짐) FAILED 가 아니라 뜨는 중으로 보인다. */
  @Test
  void resolve_whenRestartedAfterFailure_returnsStarting() {
    assertThat(resolve(RUN, 5, 4L, "FAILED")).isEqualTo(AgentRuntimeStatus.STARTING);
  }

  /** 새 설정을 쉴 때로 미룬 실패(failureHeldUntilIdle)는 관찰이 뒤처져도 FAILED 로 둔다(WP-2000). */
  @Test
  void resolve_whenOlderFailureHeldUntilIdle_returnsFailed() {
    assertThat(resolve(RUN, 4, 3L, "FAILED", null, true)).isEqualTo(AgentRuntimeStatus.FAILED);
  }

  /** 미루지 않은 옛 실패는 새 설정으로 뜨는 중이라 STARTING — 위와 값은 같고 플래그만 다르다(WP-2000). */
  @Test
  void resolve_whenOlderFailureNotHeld_returnsStarting() {
    assertThat(resolve(RUN, 4, 3L, "FAILED", null, false)).isEqualTo(AgentRuntimeStatus.STARTING);
  }

  /** 끄기를 원하고 아직 뜬 적 없거나 멈췄으면 OFF. */
  @Test
  void resolve_whenStopAndStoppedOrNeverStarted_returnsOff() {
    assertThat(resolve(STOP, 1, null, null)).isEqualTo(AgentRuntimeStatus.OFF);
    assertThat(resolve(STOP, 4, 4L, "STOPPED")).isEqualTo(AgentRuntimeStatus.OFF);
  }

  /** 끄기를 원하는데 아직 돌고 있으면 STOPPING. */
  @Test
  void resolve_whenStopButRunning_returnsStopping() {
    assertThat(resolve(STOP, 3, 2L, "RUNNING")).isEqualTo(AgentRuntimeStatus.STOPPING);
  }

  /** 켜기를 원하고 아직 관찰이 없거나 뜨는 중이면 STARTING. */
  @Test
  void resolve_whenRunAndNotObservedOrStarting_returnsStarting() {
    assertThat(resolve(RUN, 2, null, null)).isEqualTo(AgentRuntimeStatus.STARTING);
    assertThat(resolve(RUN, 2, 2L, "STARTING")).isEqualTo(AgentRuntimeStatus.STARTING);
  }

  /** 돌고 있지만 관찰한 generation 이 뒤처졌으면 APPLY_PENDING(새 설정 적용 대기). */
  @Test
  void resolve_whenRunningAndBehind_returnsApplyPending() {
    assertThat(resolve(RUN, 5, 4L, "RUNNING")).isEqualTo(AgentRuntimeStatus.APPLY_PENDING);
  }

  /** 돌고 있고 최신 generation 을 반영했으면 RUNNING. */
  @Test
  void resolve_whenRunningAndCurrent_returnsRunning() {
    assertThat(resolve(RUN, 5, 5L, "RUNNING")).isEqualTo(AgentRuntimeStatus.RUNNING);
  }

  /** 그 밖(켜기를 원하는데 멈춤·멈추는 중으로 보고됨)은 STARTING. */
  @Test
  void resolve_whenRunButStopped_returnsStarting() {
    assertThat(resolve(RUN, 5, 4L, "STOPPED")).isEqualTo(AgentRuntimeStatus.STARTING);
    assertThat(resolve(RUN, 5, 5L, "STOPPING")).isEqualTo(AgentRuntimeStatus.STARTING);
  }

  /** 차단 메시지가 있으면 phase 가 무엇이든(시작 중·실행 중·관찰 없음) 가장 앞에서 FAILED 다(WP-1913). */
  @Test
  void 차단_메시지가_있으면_어떤_단계에서도_FAILED() {
    assertThat(resolve(RUN, 3, 3L, "RUNNING", "설정 오류로 칸을 못 띄웠어요", false))
        .isEqualTo(AgentRuntimeStatus.FAILED);
    assertThat(resolve(RUN, 3, 3L, "STARTING", "설정 오류로 칸을 못 띄웠어요", false))
        .isEqualTo(AgentRuntimeStatus.FAILED);
    assertThat(resolve(RUN, 3, null, null, "설정 오류로 칸을 못 띄웠어요", false))
        .isEqualTo(AgentRuntimeStatus.FAILED);
    assertThat(resolve(RUN, 3, 3L, "FAILED", "설정 오류로 칸을 못 띄웠어요", false))
        .isEqualTo(AgentRuntimeStatus.FAILED);
  }

  /** 차단 메시지가 없으면(5인자 null·공백) 기존 규칙 그대로 계산된다(WP-1913). */
  @Test
  void 차단_메시지가_없으면_지금처럼_계산() {
    assertThat(resolve(RUN, 5, 5L, "RUNNING", null, false)).isEqualTo(AgentRuntimeStatus.RUNNING);
    assertThat(resolve(RUN, 5, 4L, "RUNNING", null, false))
        .isEqualTo(AgentRuntimeStatus.APPLY_PENDING);
    assertThat(resolve(RUN, 3, 3L, "FAILED", null, false)).isEqualTo(AgentRuntimeStatus.FAILED);
    assertThat(resolve(STOP, 3, 2L, "RUNNING", null, false)).isEqualTo(AgentRuntimeStatus.STOPPING);
    assertThat(resolve(STOP, 4, 4L, "STOPPED", null, false)).isEqualTo(AgentRuntimeStatus.OFF);
    assertThat(resolve(RUN, 2, null, null, null, false)).isEqualTo(AgentRuntimeStatus.STARTING);
    // 공백만 있는 메시지는 없다고 본다(저장 검증이 공백을 막지만 읽기에서도 방어).
    assertThat(resolve(RUN, 5, 5L, "RUNNING", "   ", false)).isEqualTo(AgentRuntimeStatus.RUNNING);
  }

  /**
   * 끄기를 원하고 이미 멈췄다면(또는 아직 관찰된 바가 없다면) 차단이 있어도 OFF 다 — 「끄기」를 누른 뒤에도 차단 사유 칸이 그대로라 「오류」가 영원히 남는 것을
   * 막는다(WP-1913). 끄는 중(드레인)의 잠깐 FAILED 는 아래 {@link #끄는_중에는_차단이_먼저다} 가 지킨다.
   */
  @Test
  void 끄기를_원하고_멈췄다면_차단이_있어도_OFF() {
    assertThat(resolve(STOP, 4, 4L, "STOPPED", "설정 오류로 칸을 못 띄웠어요", false))
        .isEqualTo(AgentRuntimeStatus.OFF);
    assertThat(resolve(STOP, 4, null, null, "설정 오류로 칸을 못 띄웠어요", false))
        .isEqualTo(AgentRuntimeStatus.OFF);
  }

  /**
   * 끄는 중(드레인 — 아직 멈추는 중·돌고 있는 중)에는 차단이 먼저다 — 끄는 데에도 이유가 보여야 화면에서 무엇이 막혔는지 안다(설계 결정 4, WP-1913). 멈춘
   * 뒤에만 OFF 로 넘어간다.
   */
  @Test
  void 끄는_중에는_차단이_먼저다() {
    assertThat(resolve(STOP, 4, 3L, "STOPPING", "설정 오류로 칸을 못 띄웠어요", false))
        .isEqualTo(AgentRuntimeStatus.FAILED);
    assertThat(resolve(STOP, 4, 2L, "RUNNING", "설정 오류로 칸을 못 띄웠어요", false))
        .isEqualTo(AgentRuntimeStatus.FAILED);
    assertThat(resolve(STOP, 4, 4L, "STARTING", "설정 오류로 칸을 못 띄웠어요", false))
        .isEqualTo(AgentRuntimeStatus.FAILED);
  }

  /**
   * 켜기를 원하는데 멈춰 있다면(관리자가 껐다 켜는 사이)도 차단이 먼저다 — 끄기와 달리 OFF 로 물러날 상태가 없고, 이유를 잃으면 무엇이 막혔는지 모른다
   * (WP-1913).
   */
  @Test
  void 켜기를_원하고_멈췄다면_차단이_먼저다() {
    assertThat(resolve(RUN, 4, 4L, "STOPPED", "설정 오류로 칸을 못 띄웠어요", false))
        .isEqualTo(AgentRuntimeStatus.FAILED);
  }

  /** 지금 generation 에서 보고한 차단 사유는 그대로 읽는다(WP-1913 리뷰 반려 ①). */
  @Test
  void 지금_generation에서_보고한_차단만_합친다() {
    assertThat(currentPaneBlocked("설정 오류", 3L, 3L, at(10), at(1), null, null)).isEqualTo("설정 오류");
    // 모를 때(플러그인을 갈아끼우기 전 이미지)는 지금 것을 본다 — 계약이 날로 없어지지 않게.
    assertThat(currentPaneBlocked("설정 오류", null, 3L, at(10), at(1), null, null)).isEqualTo("설정 오류");
    // 시각을 모를 때(관찰 전)도 견주지 않는다.
    assertThat(currentPaneBlocked("설정 오류", 3L, 3L, null, at(1), null, null)).isEqualTo("설정 오류");
    assertThat(currentPaneBlocked("설정 오류", 3L, 3L, at(10), null, null, null)).isEqualTo("설정 오류");
    assertThat(currentPaneBlocked(null, 3L, 3L, null, null, null, null)).isNull();
  }

  /**
   * 옛 generation 에서 보고한 차단 사유는 읽지 않는다 — 설정을 고쳐 새 generation 이 뜬 뒤에 옛 사유가 「오류」로 남지 않게(WP-1913 리뷰 반려
   * ①).
   */
  @Test
  void 옛_generation에서_보고한_차단은_합치지_않는다() {
    assertThat(currentPaneBlocked("설정 오류", 3L, 4L, at(10), at(1), null, null)).isNull();
  }

  /**
   * 지금 Pod 가 뜬 시각보다 30초 넘게 먼저 남은 차단 사유는 읽지 않는다 — 재시작해 같은 generation 으로 새 Pod 가 뜬 뒤에도 옛 Pod 의 사유가
   * 「오류」로 남지 않게 (WP-1913 리뷰 반려 ①). 반대로 시작 시각 30초 안의 차단은 지금 Pod 의 것으로 읽는다 — 진입점 차단은 Pod 가 뜬 뒤 몇 초 안에
   * 오는데 blockedAt 은 API 서버 시계, startedAt 은 runner·kubelet 시계라 몇 초만 어긋나도 진짜 차단이 「Pod 시작 전 보고」로 잘못
   * 가려졌다(WP-1913 리뷰 반려 ② — WP-1253 칸 거르기와 같은 30초 여유). 시작 시각 이후의 보고는 그대로다.
   */
  @Test
  void 새_Pod가_뜬_뒤_남은_옛_차단은_합치지_않는다() {
    assertThat(currentPaneBlocked("설정 오류", 3L, 3L, at(1), at(40), null, null)).isNull();
    // 정확히 30초 차이(isBefore 가 거짓)는 경계 안 — 지금 Pod 의 것으로 합친다.
    assertThat(currentPaneBlocked("설정 오류", 3L, 3L, at(10), at(40), null, null)).isEqualTo("설정 오류");
    assertThat(currentPaneBlocked("설정 오류", 3L, 3L, at(11), at(40), null, null)).isEqualTo("설정 오류");
    assertThat(currentPaneBlocked("설정 오류", 3L, 3L, at(40), at(40), null, null)).isEqualTo("설정 오류");
    assertThat(currentPaneBlocked("설정 오류", 3L, 3L, at(50), at(40), null, null)).isEqualTo("설정 오류");
  }

  /**
   * 차단한 Pod 시작 시각(WP-1958)이 지금 Pod 시작보다 30초 넘게 앞서면 옛 Pod 의 차단이라 가린다 — 관찰 started_at 이 옛 Pod 인 채로 새
   * Pod 가 보고해 기준이 올라간 경우도 포함. 시각을 모르거나 경계 안이면 읽는다.
   */
  @Test
  void currentPaneBlocked_차단한_파드가_지금_파드보다_앞서면_가린다() {
    // 관찰 started_at=at(1)(옛 Pod), 보고로 올라간 지금 Pod=at(50) — 차단한 Pod at(1) 은 옛 것
    assertThat(currentPaneBlocked("설정 오류", 3L, 3L, null, at(1), at(1), at(50))).isNull();
    // 정확히 30초 앞선 차단(at(20) vs at(50))은 경계 안
    assertThat(currentPaneBlocked("설정 오류", 3L, 3L, null, at(1), at(20), at(50))).isEqualTo("설정 오류");
    // 차단한 Pod 시각을 모르면(옛 이미지) 이 판정은 건너뛴다
    assertThat(currentPaneBlocked("설정 오류", 3L, 3L, null, at(1), null, at(50))).isEqualTo("설정 오류");
    // 지금 Pod 시작을 둘 다 모르면 견줄 수 없다
    assertThat(currentPaneBlocked("설정 오류", 3L, 3L, null, null, at(1), null)).isEqualTo("설정 오류");
  }

  private static java.time.OffsetDateTime at(int second) {
    return java.time.OffsetDateTime.of(2026, 11, 21, 20, 0, second, 0, java.time.ZoneOffset.UTC);
  }
}
