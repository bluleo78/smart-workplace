package com.workplace.agentruntime;

import static com.workplace.agentruntime.dto.Desired.RUN;
import static com.workplace.agentruntime.dto.Desired.STOP;
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
}
