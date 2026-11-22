package com.workplace.agentruntime;

import static com.workplace.agentruntime.dto.AgentState.IDLE;
import static com.workplace.agentruntime.dto.AgentState.WORKING;
import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.agentruntime.dto.AgentState;
import com.workplace.agentruntime.dto.CreateAgentLocationRequest;
import com.workplace.agentruntime.dto.PutAgentRuntimeSettingRequest;
import com.workplace.agentruntime.dto.RunnerObservedAgent;
import com.workplace.agentruntime.repository.AgentRuntimeSettingRepository;
import com.workplace.agentruntime.repository.AgentRuntimeSettingRepository.Row;
import com.workplace.agentruntime.repository.AgentRuntimeSlotRepository;
import com.workplace.agentruntime.repository.AgentRuntimeSlotRepository.PodStarts;
import com.workplace.agentruntime.repository.AgentRuntimeSlotRepository.Slot;
import com.workplace.agentruntime.service.AgentLocationService;
import com.workplace.agentruntime.service.AgentRuntimeSettingService;
import com.workplace.global.tenant.TenantContext;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.TestFixtures;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Map;
import org.jooq.DSLContext;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.annotation.Transactional;

/**
 * WP-1409 칸별 AI 상태 저장(agent_runtime_slot_state) 리포지토리 통합 테스트 — 칸 덮어쓰기·칸 키 순서·옛 Pod 칸 정리·설정 삭제
 * 연쇄·테넌트 격리와, 합친 값을 실행 설정의 agent_* 칸에 쓰는 {@link AgentRuntimeSettingRepository#writeAgentState}.
 */
@Transactional
class AgentRuntimeSlotRepositoryTest extends IntegrationTestBase {

  private static final OffsetDateTime T0 =
      OffsetDateTime.of(2026, 11, 6, 10, 0, 0, 0, ZoneOffset.UTC);
  private static final OffsetDateTime T1 = T0.plusHours(1);

  @Autowired DSLContext dsl;
  @Autowired AgentLocationService locationService;
  @Autowired AgentRuntimeSettingService settingService;
  @Autowired AgentRuntimeSettingRepository settings;
  @Autowired AgentRuntimeSlotRepository slots;

  private long admin;
  private long agent;

  /** AgentStatusReportApiTest 와 같은 시드 — 실행 설정 하나(켜짐). */
  @BeforeEach
  void seed() {
    TenantContext.set(1L);
    admin = TestFixtures.activeMemberOfCurrentTenant(dsl, TestFixtures.createHuman(dsl));
    TestFixtures.grantRole(dsl, admin, "ADMIN");
    locationService.create(admin, new CreateAgentLocationRequest("L1", null, 5));
    agent = TestFixtures.activeMemberOfCurrentTenant(dsl, TestFixtures.createAgentNoToken(dsl));
    settingService.put(
        admin, agent, new PutAgentRuntimeSettingRequest("claude-code", null, Map.of(), null));
    settingService.start(admin, agent);
  }

  private List<String> keysOf(long agentUserId) {
    // findAll 은 순서를 정하지 않는다(정렬은 합치기가 한다) — 비교하기 쉽게 여기서 정렬한다.
    return slots.findAll(agentUserId).stream().map(Slot::slotKey).sorted().toList();
  }

  /** 같은 칸의 보고는 덮어쓴다 — 쉬는 중 보고가 옛 이슈 키를 지운다. */
  @Test
  void upsert_overwritesSameSlot() {
    slots.upsert(agent, "WP", WORKING, "WP-1", null, T0, null);
    slots.upsert(agent, "WP", IDLE, null, T1, T1, null);

    List<Slot> all = slots.findAll(agent);
    assertThat(all).hasSize(1);
    assertThat(all.get(0).state()).isEqualTo(AgentState.IDLE);
    assertThat(all.get(0).issueKey()).isNull();
    assertThat(all.get(0).nextCheckAt().toInstant()).isEqualTo(T1.toInstant());
    assertThat(all.get(0).reportedAt().toInstant()).isEqualTo(T1.toInstant());
  }

  /** 그 AI 의 칸을 모두 읽는다(순서는 정하지 않는다 — 정렬은 합치기 한 곳에서). 여러 AI 를 한 번에 읽을 수도 있다. */
  @Test
  void findAll_returnsAllSlotsOfAgent() {
    slots.upsert(agent, "WP", IDLE, null, null, T0, null);
    slots.upsert(agent, "", IDLE, null, null, T0, null);
    slots.upsert(agent, "HR", IDLE, null, null, T0, null);

    assertThat(slots.findAll(agent))
        .extracting(Slot::slotKey)
        .containsExactlyInAnyOrder("", "HR", "WP");
    assertThat(slots.findAllOf(List.of(agent)).get(agent)).hasSize(3);
  }

  /**
   * 옛 Pod 칸 판정(메모리)과 SQL 지우기가 같은 기준(시작 시각 − 30초 시계 차이 여유)을 쓴다(WP-1409) — 시작 10초 전 보고는 새 Pod 의 것일 수
   * 있어 남기고 5분 전 보고는 옛 Pod 의 것이라 지운다. 시작 시각을 모르면 옛 Pod 칸으로 보지 않는다.
   */
  @Test
  void oldPodRule_appliesClockSkewGraceInMemoryAndSql() {
    Slot recent = new Slot("HR", WORKING, "HR-1", null, T0.minusSeconds(10), null);
    Slot old = new Slot("WP", WORKING, "WP-1", null, T0.minusMinutes(5), null);
    assertThat(AgentRuntimeSlotRepository.isFromOldPod(recent, T0, T0)).isFalse();
    assertThat(AgentRuntimeSlotRepository.isFromOldPod(old, T0, T0)).isTrue();
    assertThat(AgentRuntimeSlotRepository.isFromOldPod(old, null, null)).isFalse();

    slots.upsert(agent, "HR", WORKING, "HR-1", null, recent.reportedAt(), null);
    slots.upsert(agent, "WP", WORKING, "WP-1", null, old.reportedAt(), null);

    // 남길 칸(보고 흐름의 방금 보고한 칸)은 옛 Pod 기준에 걸려도 지우지 않는다.
    assertThat(slots.deleteReportedBeforePodStart(Map.of(agent, new PodStarts(T0, T0)), "WP"))
        .isEmpty();
    assertThat(keysOf(agent)).containsExactly("HR", "WP");

    assertThat(slots.deleteReportedBeforePodStart(Map.of(agent, new PodStarts(T0, T0)), null))
        .containsExactly(agent);
    assertThat(keysOf(agent)).containsExactly("HR");
    // 지울 것이 없으면 아무 AI 도 돌려주지 않는다.
    assertThat(slots.deleteReportedBeforePodStart(Map.of(agent, new PodStarts(T0, T0)), null))
        .isEmpty();
  }

  /** 실행 설정을 지우면 칸도 함께 사라진다(FK CASCADE). */
  @Test
  void slots_areDeletedWithSetting() {
    slots.upsert(agent, "WP", WORKING, "WP-1", null, T0, null);

    settings.delete(agent);

    assertThat(slots.findAll(agent)).isEmpty();
  }

  /** 다른 워크스페이스에서는 칸이 보이지 않는다(RLS). */
  @Test
  void slots_areTenantIsolated() {
    slots.upsert(agent, "WP", WORKING, "WP-1", null, T0, null);
    long tenant2 = TestFixtures.createTenant(dsl, "ACTIVE");

    useTenant(tenant2);
    assertThat(slots.findAll(agent)).isEmpty();
    assertThat(slots.deleteReportedBeforePodStart(Map.of(agent, new PodStarts(T1, T1)), null))
        .isEmpty();

    useTenant(1L);
    assertThat(keysOf(agent)).containsExactly("WP");
  }

  /** 합친 값은 agent_* 칸만 쓰고 원하는 상태·generation 등은 그대로 둔다. 현재 이슈 키는 목록의 첫 키다. */
  @Test
  void writeAgentState_writesAllAgentColumns() {
    Row before = settings.find(agent).orElseThrow();
    OffsetDateTime now = OffsetDateTime.now();

    Row row = settings.writeAgentState(agent, AgentState.WORKING, List.of("HR-2", "WP-9"), T1, now);

    assertThat(row.agentState()).isEqualTo("WORKING");
    assertThat(row.agentIssueKey()).isEqualTo("HR-2");
    assertThat(row.agentIssueKeys()).containsExactly("HR-2", "WP-9");
    assertThat(row.agentNextCheckAt().toInstant()).isEqualTo(T1.toInstant());
    assertThat(row.agentReportedAt()).isNotNull();
    assertThat(row.generation()).isEqualTo(before.generation());
    assertThat(row.desired()).isEqualTo(before.desired());
    assertThat(row.applyMode()).isEqualTo(before.applyMode());
    assertThat(row.templateName()).isEqualTo(before.templateName());
    assertThat(settings.find(agent).orElseThrow().agentIssueKeys()).containsExactly("HR-2", "WP-9");

    // 칸이 모두 사라지면(합친 상태 없음) 칸들이 비워진다.
    Row cleared = settings.writeAgentState(agent, null, List.of(), null, now);
    assertThat(cleared.agentState()).isNull();
    assertThat(cleared.agentIssueKeys()).isEmpty();
  }

  private static final OffsetDateTime T2 = T0.plusHours(2);

  /**
   * WP-1958 옛 Pod 판정 — 칸에 보고한 Pod 시작 시각이 있으면 지금 Pod 시작 기준으로, 없으면 지금 규칙(관찰 시작 시각 기준)으로 가른다. 메모리와 SQL
   * 이 같은 결과여야 한다.
   */
  @Test
  void oldPodRule_usesSlotPodStartWhenPresent() {
    OffsetDateTime observed = T0;
    OffsetDateTime current = T2;
    Slot a = new Slot("A", WORKING, "A-1", null, T2.plusSeconds(60), T2.minusSeconds(31));
    Slot b = new Slot("B", WORKING, "B-1", null, T2.plusSeconds(60), T2.minusSeconds(29));
    Slot c = new Slot("C", WORKING, "C-1", null, T0.minusSeconds(31), null);
    Slot d = new Slot("D", WORKING, "D-1", null, T2.minusSeconds(60), null);
    assertThat(AgentRuntimeSlotRepository.isFromOldPod(a, observed, current)).isTrue();
    assertThat(AgentRuntimeSlotRepository.isFromOldPod(b, observed, current)).isFalse();
    assertThat(AgentRuntimeSlotRepository.isFromOldPod(c, observed, current)).isTrue();
    assertThat(AgentRuntimeSlotRepository.isFromOldPod(d, observed, current)).isFalse();
    // 정확히 30초 앞선 칸은 지금 Pod 의 것(경계), current 가 없으면 시각 있는 칸도 가를 수 없다.
    Slot edge = new Slot("E", WORKING, "E-1", null, T2, T2.minusSeconds(30));
    assertThat(AgentRuntimeSlotRepository.isFromOldPod(edge, observed, current)).isFalse();
    assertThat(AgentRuntimeSlotRepository.isFromOldPod(a, observed, null)).isFalse();

    for (Slot s : List.of(a, b, c, d, edge)) {
      slots.upsert(
          agent, s.slotKey(), WORKING, s.issueKey(), null, s.reportedAt(), s.podStartedAt());
    }
    assertThat(
            slots.deleteReportedBeforePodStart(
                Map.of(agent, new PodStarts(observed, current)), null))
        .containsExactly(agent);
    // 정확히 cutoff 인 edge 칸은 SQL 지우기에서도 살아남는다(메모리 판정과 같은 경계).
    assertThat(keysOf(agent)).containsExactly("B", "D", "E");

    // 지금 Pod 시작을 모르면(current null) 시각 있는 칸은 지우지 않고, 시각 없는 칸만 관찰값으로 가른다.
    slots.upsert(agent, "A", WORKING, "A-1", null, T2.plusSeconds(60), T2.minusSeconds(31));
    slots.upsert(agent, "C", WORKING, "C-1", null, T0.minusSeconds(31), null);
    assertThat(
            slots.deleteReportedBeforePodStart(Map.of(agent, new PodStarts(observed, null)), null))
        .containsExactly(agent);
    assertThat(keysOf(agent)).containsExactly("A", "B", "D", "E");
  }

  /**
   * WP-1958 observed 가 null(runner 가 아직 새 Pod 를 관찰 못 함)이고 current 만 있는 경우 — 시각 있는 칸은 current 기준으로
   * 지워지고(cutoff 앞은 삭제, 정확히 cutoff 는 생존), 시각 없는 칸은 관찰값이 없어 가를 수 없으므로 지우지 않는다(메모리 isFromOldPod 도
   * observed null 이면 거짓).
   */
  @Test
  void oldPodRule_observedNull_judgesByCurrentOnly() {
    slots.upsert(agent, "A", WORKING, "A-1", null, T2, T2.minusSeconds(31));
    slots.upsert(agent, "B", WORKING, "B-1", null, T2, T2.minusSeconds(30));
    slots.upsert(agent, "C", WORKING, "C-1", null, T0.minusSeconds(3600), null);

    assertThat(slots.deleteReportedBeforePodStart(Map.of(agent, new PodStarts(null, T2)), null))
        .containsExactly(agent);

    assertThat(keysOf(agent)).containsExactly("B", "C");
  }

  /** 서버 시각보다 30초 넘게 앞선 보고 Pod 시작 시각은 시계 이상으로 보고 버린다(null). */
  @Test
  void acceptedPodStart_dropsFutureBeyondGrace() {
    OffsetDateTime now = T0;
    assertThat(AgentRuntimeSlotRepository.acceptedPodStart(now.plusSeconds(30), now))
        .isEqualTo(now.plusSeconds(30));
    assertThat(AgentRuntimeSlotRepository.acceptedPodStart(now.plusSeconds(31), now)).isNull();
    assertThat(AgentRuntimeSlotRepository.acceptedPodStart(null, now)).isNull();
  }

  /** 지금 Pod 시작은 관찰값·보고값 중 null 아닌 늦은 쪽. */
  @Test
  void currentPodStart_takesLaterNonNull() {
    assertThat(AgentRuntimeSlotRepository.currentPodStart(T1, null)).isEqualTo(T1);
    assertThat(AgentRuntimeSlotRepository.currentPodStart(null, T2)).isEqualTo(T2);
    assertThat(AgentRuntimeSlotRepository.currentPodStart(T1, T2)).isEqualTo(T2);
    assertThat(AgentRuntimeSlotRepository.currentPodStart(null, null)).isNull();
  }

  /** 칸에 보고한 Pod 시작 시각이 저장되고 읽힌다. */
  @Test
  void upsert_storesPodStartedAt() {
    slots.upsert(agent, "WP", WORKING, "WP-1", null, T0, T2);
    assertThat(slots.findAll(agent).get(0).podStartedAt().toInstant()).isEqualTo(T2.toInstant());
    slots.upsert(agent, "WP", WORKING, "WP-1", null, T1, null);
    assertThat(slots.findAll(agent).get(0).podStartedAt()).isNull();
  }

  /** 보고한 Pod 시작 시각은 올라가기만 한다(GREATEST). */
  @Test
  void raiseReportedPodStart_neverGoesDown() {
    assertThat(settings.find(agent).orElseThrow().reportedPodStartedAt()).isNull();
    settings.raiseReportedPodStart(agent, T2);
    settings.raiseReportedPodStart(agent, T1);
    assertThat(settings.find(agent).orElseThrow().reportedPodStartedAt().toInstant())
        .isEqualTo(T2.toInstant());
    settings.raiseReportedPodStart(agent, null);
    assertThat(settings.find(agent).orElseThrow().reportedPodStartedAt().toInstant())
        .isEqualTo(T2.toInstant());
  }

  private void observe(OffsetDateTime startedAt) {
    Row row = settings.find(agent).orElseThrow();
    long location = row.locationId() == null ? 0L : row.locationId();
    settings.updateObserved(
        location,
        true,
        List.of(new RunnerObservedAgent(agent, null, "RUNNING", null, null, null, startedAt)));
  }

  /** runner 가 관찰한 started_at 이 보고한 Pod 시작보다 늦으면(새 Pod) 보고한 값을 비운다 — 같은 값·더 이른 값이면 그대로(WP-1958). */
  @Test
  void updateObserved_newStartedAt_clearsReportedPodStart() {
    observe(T0);
    settings.raiseReportedPodStart(agent, T1);

    observe(T0);
    assertThat(settings.find(agent).orElseThrow().reportedPodStartedAt()).isNotNull();

    observe(T2);
    assertThat(settings.find(agent).orElseThrow().reportedPodStartedAt()).isNull();
  }

  /** null 보고 뒤 옛 Pod 의 startTime 을 다시 관찰해도 새 Pod 가 올린 시작 시각은 비우지 않는다(WP-1958). */
  @Test
  void updateObserved_reobservingOldPodAfterNull_keepsReportedPodStart() {
    observe(T0);
    settings.raiseReportedPodStart(agent, T2);

    observe(null);
    observe(T1);

    assertThat(settings.find(agent).orElseThrow().reportedPodStartedAt().toInstant())
        .isEqualTo(T2.toInstant());
  }

  /** runner 가 순간적으로 started_at 을 null 로 보고(STARTING 등)해도 보고한 Pod 시작 시각은 비우지 않는다. */
  @Test
  void updateObserved_nullStartedAt_keepsReportedPodStart() {
    observe(T0);
    settings.raiseReportedPodStart(agent, T2);

    observe(null);

    assertThat(settings.find(agent).orElseThrow().reportedPodStartedAt()).isNotNull();
  }

  /** 진입점 차단 보고에 Pod 시작 시각을 함께 저장하고, 차단이 풀리면(message null) 비운다. */
  @Test
  void updatePaneBlocked_storesAndClearsPodStart() {
    settings.updatePaneBlocked(agent, "막힘", T1, null, T2);
    Row blocked = settings.find(agent).orElseThrow();
    assertThat(blocked.paneBlockedPodStartedAt().toInstant()).isEqualTo(T2.toInstant());

    settings.updatePaneBlocked(agent, null, null, null, T2);
    assertThat(settings.find(agent).orElseThrow().paneBlockedPodStartedAt()).isNull();
  }
}
