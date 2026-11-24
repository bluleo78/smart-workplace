package com.workplace.agentruntime.service;

import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.agentruntime.dto.ApplyMode;
import com.workplace.agentruntime.dto.Desired;
import com.workplace.agentruntime.repository.AgentRuntimeSettingRepository.Row;
import com.workplace.agentruntime.service.RolloutPolicy.Decision;
import com.workplace.auth.dto.ManagedKeyChain;
import java.time.Duration;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;

/**
 * 적용 판정의 「진행 중인 일 없음」이 칸 거르기와 같은 규칙(isOldPodReport — Pod 정체 우선, 없으면 시각)을 쓰는지 검증한다(WP-2010). 순수 단위
 * 테스트 — DB 없이 Row 만 만들어 {@link RolloutPolicy#decide} 에 묻는다.
 */
class RolloutPolicyTest {

  private static final OffsetDateTime T0 = OffsetDateTime.parse("2026-11-23T10:00:00Z");
  private static final Duration STALE = Duration.ofMinutes(5);

  /** 쉴 때 적용 대기 중 + 지금 Pod 가 T0 에 뜨고 진입점이 막힌 행. 차단은 지금 Pod(uid new)의 것. AI 상태는 칸이 비어 null. */
  private static Row blockedRow(OffsetDateTime agentReportedAt, String agentReportedPodUid) {
    return blockedRow(agentReportedAt, agentReportedPodUid, null, "new");
  }

  /**
   * 차단 행 — 마지막 상태 보고의 Pod 시작 시각과 차단을 보고한 Pod 정체를 고른다. 관찰한 지금 Pod 정체는 new, 차단 Pod 시작은 T0.
   *
   * @param agentReportedPodStartedAt 마지막 상태 보고를 낸 칸의 Pod 시작 시각(없으면 null)
   * @param paneBlockedPodUid 차단을 보고한 Pod 정체
   */
  private static Row blockedRow(
      OffsetDateTime agentReportedAt,
      String agentReportedPodUid,
      OffsetDateTime agentReportedPodStartedAt,
      String paneBlockedPodUid) {
    return new Row(
        1L,
        "t",
        "v",
        null,
        Map.of(),
        Desired.RUN,
        ApplyMode.IDLE,
        2L,
        1L,
        null,
        "RUNNING",
        null,
        null,
        null,
        T0,
        "new",
        null,
        null,
        null,
        null,
        T0,
        null,
        null,
        List.of(),
        null,
        agentReportedAt,
        agentReportedPodUid,
        agentReportedPodStartedAt,
        "막힘",
        T0.plusSeconds(5),
        1L,
        null,
        T0,
        paneBlockedPodUid,
        true,
        null);
  }

  /** 시작 실패(FAILED) 행 — 차단 메시지는 없다. 지금 Pod uid 는 new. */
  private static Row failedRow(OffsetDateTime agentReportedAt, String agentReportedPodUid) {
    return failedRow(agentReportedAt, agentReportedPodUid, "new");
  }

  /** 시작 실패(FAILED) 행 — 지금 Pod uid(관찰 정체)를 고른다. null 이면 아직 관찰이 정체를 밝히지 못한 상태. */
  private static Row failedRow(
      OffsetDateTime agentReportedAt, String agentReportedPodUid, String observedPodUid) {
    return new Row(
        1L,
        "t",
        "v",
        null,
        Map.of(),
        Desired.RUN,
        ApplyMode.IDLE,
        2L,
        1L,
        null,
        "FAILED",
        null,
        null,
        null,
        T0,
        observedPodUid,
        null,
        null,
        null,
        null,
        T0,
        null,
        null,
        List.of(),
        null,
        agentReportedAt,
        agentReportedPodUid,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        true,
        null);
  }

  private static Decision decide(Row row) {
    return RolloutPolicy.decide(row, ManagedKeyChain.EMPTY, T0.plusSeconds(20), STALE);
  }

  @Test
  void blocked_reportFromOtherPodUid_isOldEvenIfTimeLooksCurrent() {
    // (a) 시각상 지금 Pod 뒤지만 Pod 정체가 달라 옛 Pod 보고 — 일 없음 → 바로 적용
    assertThat(decide(blockedRow(T0.plusSeconds(10), "old"))).isEqualTo(Decision.NOW);
  }

  @Test
  void blocked_reportFromSamePodUid_meansWorkInProgress() {
    // (b) 정체가 같으면 지금 Pod 의 보고 — 일이 있을 수 있어 쉴 때까지 둔다
    assertThat(decide(blockedRow(T0.plusSeconds(10), "new"))).isEqualTo(Decision.AT_IDLE);
  }

  @Test
  void blocked_samePodUid_containerRestart_earlierPodStartMeansNoWork() {
    // (c) 정체가 같아도 보고 칸의 Pod 시작이 차단 Pod 시작 −30초보다 이르면 같은 Pod 안 재시작 전 컨테이너의 것 — 일 없음 → 바로 적용(WP-1969
    // 흐름). 같은 노드 시계끼리라 견줄 수 있다(R2 ②).
    assertThat(decide(blockedRow(T0.plusSeconds(10), "new", T0.minusSeconds(31), "new")))
        .isEqualTo(Decision.NOW);
    // 여유(30초) 안이면 같은 컨테이너의 보고로 본다 — 쉴 때까지 둔다
    assertThat(decide(blockedRow(T0.plusSeconds(10), "new", T0.minusSeconds(29), "new")))
        .isEqualTo(Decision.AT_IDLE);
  }

  @Test
  void blocked_samePodUid_withoutPodStart_doesNotCompareReportTime() {
    // (c') 같은 정체 + 보고 Pod 시작 없음 — 보고 시각(API 시계)을 노드 시계 기준과 견주지 않는다(R2 ③). 시각상 한참 앞이어도 일 있음
    assertThat(decide(blockedRow(T0.minusSeconds(31), "new"))).isEqualTo(Decision.AT_IDLE);
    assertThat(decide(blockedRow(T0.minusMinutes(10), "new"))).isEqualTo(Decision.AT_IDLE);
  }

  @Test
  void blocked_byOtherPodThanObserved_usesTimeRuleNotIdentity() {
    // (g) 차단을 기록한 Pod(blk)가 관찰한 지금 Pod(new)가 아니면 차단 Pod 정체로 가르지 않는다(R3) — 더 새 Pod(new)의 보고를 정체 불일치로
    // 옛 것이라 하지 않게. 시각 규칙이라 차단 Pod 시작 뒤의 보고는 일 있음
    assertThat(decide(blockedRow(T0.plusSeconds(10), "new", null, "blk")))
        .isEqualTo(Decision.AT_IDLE);
    // 시각 규칙 — 차단 Pod 시작 −30초보다 이른 보고는 일 없음
    assertThat(decide(blockedRow(T0.minusSeconds(31), "new", null, "blk"))).isEqualTo(Decision.NOW);
  }

  @Test
  void blocked_missingPodUid_fallsBackToTimeRule() {
    // (d) 정체를 모르면 이전과 같이 시각 규칙 — 뒤면 일 있음, 31초 넘게 앞이면 일 없음
    assertThat(decide(blockedRow(T0.plusSeconds(10), null))).isEqualTo(Decision.AT_IDLE);
    assertThat(decide(blockedRow(T0.minusSeconds(31), null))).isEqualTo(Decision.NOW);
  }

  @Test
  void failed_reportFromOtherPodUid_meansNoWork() {
    // (e) 시작 실패 규칙 — 관찰한 지금 Pod(new)와 보고 Pod(old)가 다르면 일 없음 → 바로 적용
    assertThat(decide(failedRow(T0.plusSeconds(10), "old"))).isEqualTo(Decision.NOW);
    assertThat(decide(failedRow(T0.plusSeconds(10), "new"))).isEqualTo(Decision.AT_IDLE);
  }

  @Test
  void failed_observedPodUidUnknown_fallsBackToTimeRule() {
    // (f) 시작 실패 규칙에서 관찰 정체를 아직 모르면 보고 정체가 달라도 정체로 가르지 않고 시각 규칙 — 뒤면 일 있음, 31초 넘게 앞이면 일 없음
    assertThat(decide(failedRow(T0.plusSeconds(10), "old", null))).isEqualTo(Decision.AT_IDLE);
    assertThat(decide(failedRow(T0.minusSeconds(31), "old", null))).isEqualTo(Decision.NOW);
  }
}
