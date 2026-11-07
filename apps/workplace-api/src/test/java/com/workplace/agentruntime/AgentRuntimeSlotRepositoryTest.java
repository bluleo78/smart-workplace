package com.workplace.agentruntime;

import static com.workplace.agentruntime.dto.AgentState.IDLE;
import static com.workplace.agentruntime.dto.AgentState.WORKING;
import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.agentruntime.dto.AgentState;
import com.workplace.agentruntime.dto.CreateAgentLocationRequest;
import com.workplace.agentruntime.dto.PutAgentRuntimeSettingRequest;
import com.workplace.agentruntime.repository.AgentRuntimeSettingRepository;
import com.workplace.agentruntime.repository.AgentRuntimeSettingRepository.Row;
import com.workplace.agentruntime.repository.AgentRuntimeSlotRepository;
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
    slots.upsert(agent, "WP", WORKING, "WP-1", null, T0);
    slots.upsert(agent, "WP", IDLE, null, T1, T1);

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
    slots.upsert(agent, "WP", IDLE, null, null, T0);
    slots.upsert(agent, "", IDLE, null, null, T0);
    slots.upsert(agent, "HR", IDLE, null, null, T0);

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
    Slot recent = new Slot("HR", WORKING, "HR-1", null, T0.minusSeconds(10));
    Slot old = new Slot("WP", WORKING, "WP-1", null, T0.minusMinutes(5));
    assertThat(AgentRuntimeSlotRepository.isFromOldPod(recent, T0)).isFalse();
    assertThat(AgentRuntimeSlotRepository.isFromOldPod(old, T0)).isTrue();
    assertThat(AgentRuntimeSlotRepository.isFromOldPod(old, null)).isFalse();

    slots.upsert(agent, "HR", WORKING, "HR-1", null, recent.reportedAt());
    slots.upsert(agent, "WP", WORKING, "WP-1", null, old.reportedAt());

    // 남길 칸(보고 흐름의 방금 보고한 칸)은 옛 Pod 기준에 걸려도 지우지 않는다.
    assertThat(slots.deleteReportedBeforePodStart(Map.of(agent, T0), "WP")).isEmpty();
    assertThat(keysOf(agent)).containsExactly("HR", "WP");

    assertThat(slots.deleteReportedBeforePodStart(Map.of(agent, T0), null)).containsExactly(agent);
    assertThat(keysOf(agent)).containsExactly("HR");
    // 지울 것이 없으면 아무 AI 도 돌려주지 않는다.
    assertThat(slots.deleteReportedBeforePodStart(Map.of(agent, T0), null)).isEmpty();
  }

  /** 실행 설정을 지우면 칸도 함께 사라진다(FK CASCADE). */
  @Test
  void slots_areDeletedWithSetting() {
    slots.upsert(agent, "WP", WORKING, "WP-1", null, T0);

    settings.delete(agent);

    assertThat(slots.findAll(agent)).isEmpty();
  }

  /** 다른 워크스페이스에서는 칸이 보이지 않는다(RLS). */
  @Test
  void slots_areTenantIsolated() {
    slots.upsert(agent, "WP", WORKING, "WP-1", null, T0);
    long tenant2 = TestFixtures.createTenant(dsl, "ACTIVE");

    useTenant(tenant2);
    assertThat(slots.findAll(agent)).isEmpty();
    assertThat(slots.deleteReportedBeforePodStart(Map.of(agent, T1), null)).isEmpty();

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
}
