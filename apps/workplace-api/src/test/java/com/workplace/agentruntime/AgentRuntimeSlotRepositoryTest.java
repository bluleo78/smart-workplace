package com.workplace.agentruntime;

import static com.workplace.agentruntime.dto.AgentState.IDLE;
import static com.workplace.agentruntime.dto.AgentState.WORKING;
import static com.workplace.jooq.Tables.AGENT_RUNTIME_SETTING;
import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.agentruntime.dto.AgentState;
import com.workplace.agentruntime.dto.CreateAgentLocationRequest;
import com.workplace.agentruntime.dto.PutAgentRuntimeSettingRequest;
import com.workplace.agentruntime.dto.RunnerObservedAgent;
import com.workplace.agentruntime.repository.AgentRuntimeSettingRepository;
import com.workplace.agentruntime.repository.AgentRuntimeSettingRepository.Row;
import com.workplace.agentruntime.repository.AgentRuntimeSlotRepository;
import com.workplace.agentruntime.repository.AgentRuntimeSlotRepository.PodIdentity;
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
    slots.upsert(agent, "WP", WORKING, "WP-1", null, T0, null, null);
    slots.upsert(agent, "WP", IDLE, null, T1, T1, null, null);

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
    slots.upsert(agent, "WP", IDLE, null, null, T0, null, null);
    slots.upsert(agent, "", IDLE, null, null, T0, null, null);
    slots.upsert(agent, "HR", IDLE, null, null, T0, null, null);

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
    Slot recent = new Slot("HR", WORKING, "HR-1", null, T0.minusSeconds(10), null, null);
    Slot old = new Slot("WP", WORKING, "WP-1", null, T0.minusMinutes(5), null, null);
    assertThat(AgentRuntimeSlotRepository.isFromOldPod(recent, null, T0, T0)).isFalse();
    assertThat(AgentRuntimeSlotRepository.isFromOldPod(old, null, T0, T0)).isTrue();
    assertThat(AgentRuntimeSlotRepository.isFromOldPod(old, null, null, null)).isFalse();

    slots.upsert(agent, "HR", WORKING, "HR-1", null, recent.reportedAt(), null, null);
    slots.upsert(agent, "WP", WORKING, "WP-1", null, old.reportedAt(), null, null);

    // 남길 칸(보고 흐름의 방금 보고한 칸)은 옛 Pod 기준에 걸려도 지우지 않는다.
    assertThat(slots.deleteReportedBeforePodStart(Map.of(agent, new PodStarts(T0, T0, null)), "WP"))
        .isEmpty();
    assertThat(keysOf(agent)).containsExactly("HR", "WP");

    assertThat(slots.deleteReportedBeforePodStart(Map.of(agent, new PodStarts(T0, T0, null)), null))
        .containsExactly(agent);
    assertThat(keysOf(agent)).containsExactly("HR");
    // 지울 것이 없으면 아무 AI 도 돌려주지 않는다.
    assertThat(slots.deleteReportedBeforePodStart(Map.of(agent, new PodStarts(T0, T0, null)), null))
        .isEmpty();
  }

  /** 실행 설정을 지우면 칸도 함께 사라진다(FK CASCADE). */
  @Test
  void slots_areDeletedWithSetting() {
    slots.upsert(agent, "WP", WORKING, "WP-1", null, T0, null, null);

    settings.delete(agent);

    assertThat(slots.findAll(agent)).isEmpty();
  }

  /** 다른 워크스페이스에서는 칸이 보이지 않는다(RLS). */
  @Test
  void slots_areTenantIsolated() {
    slots.upsert(agent, "WP", WORKING, "WP-1", null, T0, null, null);
    long tenant2 = TestFixtures.createTenant(dsl, "ACTIVE");

    useTenant(tenant2);
    assertThat(slots.findAll(agent)).isEmpty();
    assertThat(slots.deleteReportedBeforePodStart(Map.of(agent, new PodStarts(T1, T1, null)), null))
        .isEmpty();

    useTenant(1L);
    assertThat(keysOf(agent)).containsExactly("WP");
  }

  /** 합친 값은 agent_* 칸만 쓰고 원하는 상태·generation 등은 그대로 둔다. 현재 이슈 키는 목록의 첫 키다. */
  @Test
  void writeAgentState_writesAllAgentColumns() {
    Row before = settings.find(agent).orElseThrow();
    OffsetDateTime now = OffsetDateTime.now();

    Row row =
        settings.writeAgentState(
            agent, AgentState.WORKING, List.of("HR-2", "WP-9"), T1, now, "pod-a", T0);

    assertThat(row.agentState()).isEqualTo("WORKING");
    assertThat(row.agentIssueKey()).isEqualTo("HR-2");
    assertThat(row.agentIssueKeys()).containsExactly("HR-2", "WP-9");
    assertThat(row.agentNextCheckAt().toInstant()).isEqualTo(T1.toInstant());
    assertThat(row.agentReportedAt()).isNotNull();
    assertThat(row.agentReportedPodUid()).isEqualTo("pod-a");
    assertThat(row.agentReportedPodStartedAt().toInstant()).isEqualTo(T0.toInstant());
    assertThat(row.generation()).isEqualTo(before.generation());
    assertThat(row.desired()).isEqualTo(before.desired());
    assertThat(row.applyMode()).isEqualTo(before.applyMode());
    assertThat(row.templateName()).isEqualTo(before.templateName());
    assertThat(settings.find(agent).orElseThrow().agentIssueKeys()).containsExactly("HR-2", "WP-9");

    // 칸이 모두 사라지면(합친 상태 없음) 칸들이 비워진다.
    Row cleared = settings.writeAgentState(agent, null, List.of(), null, now, null, null);
    assertThat(cleared.agentState()).isNull();
    assertThat(cleared.agentReportedPodUid()).isNull();
    assertThat(cleared.agentReportedPodStartedAt()).isNull();
    assertThat(cleared.agentIssueKeys()).isEmpty();
  }

  private static final OffsetDateTime T2 = T0.plusHours(2);

  /**
   * WP-1958 옛 Pod 판정 — 칸에 보고한 Pod 시작 시각이 있으면 지금 Pod 시작 기준으로, 없으면 관찰 시작 시각 기준으로 가른다(WP-2010 R1 — 시각
   * 없는 칸은 보고가 올린 기준이 아니라 runner 가 관찰한 started_at 과 견준다). 메모리와 SQL 이 같은 결과여야 한다.
   */
  @Test
  void oldPodRule_usesSlotPodStartWhenPresent() {
    OffsetDateTime observed = T0;
    OffsetDateTime current = T2;
    Slot a = new Slot("A", WORKING, "A-1", null, T2.plusSeconds(60), T2.minusSeconds(31), null);
    Slot b = new Slot("B", WORKING, "B-1", null, T2.plusSeconds(60), T2.minusSeconds(29), null);
    Slot c = new Slot("C", WORKING, "C-1", null, T0.minusSeconds(31), null, null);
    // 시각 없는 칸은 관찰 시작(T0)과 견준다 — 지금 Pod 시작(T2)보다 앞서 보고했어도 관찰 뒤라 남는다.
    Slot d = new Slot("D", WORKING, "D-1", null, T2.minusSeconds(60), null, null);
    assertThat(AgentRuntimeSlotRepository.isFromOldPod(a, null, observed, current)).isTrue();
    assertThat(AgentRuntimeSlotRepository.isFromOldPod(b, null, observed, current)).isFalse();
    assertThat(AgentRuntimeSlotRepository.isFromOldPod(c, null, observed, current)).isTrue();
    assertThat(AgentRuntimeSlotRepository.isFromOldPod(d, null, observed, current)).isFalse();
    // 정확히 30초 앞선 칸은 지금 Pod 의 것(경계), current 가 없으면 시각 있는 칸도 가를 수 없다.
    Slot edge = new Slot("E", WORKING, "E-1", null, T2, T2.minusSeconds(30), null);
    assertThat(AgentRuntimeSlotRepository.isFromOldPod(edge, null, observed, current)).isFalse();
    assertThat(AgentRuntimeSlotRepository.isFromOldPod(a, null, observed, null)).isFalse();

    for (Slot s : List.of(a, b, c, d, edge)) {
      slots.upsert(
          agent, s.slotKey(), WORKING, s.issueKey(), null, s.reportedAt(), s.podStartedAt(), null);
    }
    assertThat(
            slots.deleteReportedBeforePodStart(
                Map.of(agent, new PodStarts(observed, current, null)), null))
        .containsExactly(agent);
    // 정확히 cutoff 인 edge 칸은 SQL 지우기에서도 살아남는다(메모리 판정과 같은 경계).
    assertThat(keysOf(agent)).containsExactly("B", "D", "E");

    // 지금 Pod 시작을 모르면(current null) 시각 있는 칸은 지우지 않고, 시각 없는 칸만 관찰값으로 가른다.
    slots.upsert(agent, "A", WORKING, "A-1", null, T2.plusSeconds(60), T2.minusSeconds(31), null);
    slots.upsert(agent, "C", WORKING, "C-1", null, T0.minusSeconds(31), null, null);
    assertThat(
            slots.deleteReportedBeforePodStart(
                Map.of(agent, new PodStarts(observed, null, null)), null))
        .containsExactly(agent);
    assertThat(keysOf(agent)).containsExactly("A", "B", "D", "E");
  }

  /**
   * WP-1958 observed 가 null(runner 가 아직 새 Pod 를 관찰 못 함)이고 current 만 있는 경우 — 시각 있는 칸은 current 기준으로
   * 지워지고(cutoff 앞은 삭제, 정확히 cutoff 는 생존), 시각 없는 칸은 관찰값이 없어 가를 수 없으므로 지우지 않는다(WP-2010 R1 — 메모리
   * isFromOldPod 도 observed null 이면 거짓).
   */
  @Test
  void oldPodRule_observedNull_judgesByCurrentOnly() {
    slots.upsert(agent, "A", WORKING, "A-1", null, T2, T2.minusSeconds(31), null);
    slots.upsert(agent, "B", WORKING, "B-1", null, T2, T2.minusSeconds(30), null);
    slots.upsert(agent, "C", WORKING, "C-1", null, T0.minusSeconds(3600), null, null);
    Slot c = new Slot("C", WORKING, "C-1", null, T0.minusSeconds(3600), null, null);
    assertThat(AgentRuntimeSlotRepository.isFromOldPod(c, null, null, T2)).isFalse();

    assertThat(
            slots.deleteReportedBeforePodStart(Map.of(agent, new PodStarts(null, T2, null)), null))
        .containsExactly(agent);

    assertThat(keysOf(agent)).containsExactly("B", "C");
  }

  /**
   * WP-2010 한 규칙 isOldPodReport 의 네 갈래 — ① 정체가 둘 다 있고 다르면 시각과 무관하게 옛 것 ② 보고에 Pod 시작 시각이 있으면 지금 Pod
   * 시작과 견준다(같은 정체도) ③ 시각 없는 같은 정체는 옛 것이 아니다 ④ 그 밖의 시각 없는 보고는 보고 시각을 시각 없는 기준(timelessBasis)과 견준다.
   */
  @Test
  void isOldPodReport_fourBranches() {
    OffsetDateTime cur = T2;
    OffsetDateTime basis = T0;
    // ① 정체가 다르면 시각이 미래여도 옛 것이다.
    assertThat(
            AgentRuntimeSlotRepository.isOldPodReport(
                "p0", cur.plusDays(1), cur.plusDays(1), "p1", cur, basis))
        .isTrue();
    assertThat(AgentRuntimeSlotRepository.isOldPodReport("p0", null, null, "p1", null, null))
        .isTrue();
    // ② 같은 정체라도 보고 Pod 시작이 지금 Pod 시작보다 여유를 넘게 이르면 옛 것(같은 Pod 안 컨테이너 재시작).
    assertThat(
            AgentRuntimeSlotRepository.isOldPodReport(
                "p1", cur.minusSeconds(31), cur, "p1", cur, basis))
        .isTrue();
    assertThat(
            AgentRuntimeSlotRepository.isOldPodReport(
                "p1", cur.minusSeconds(29), T0.minusDays(1), "p1", cur, basis))
        .isFalse();
    // ② 정체를 모르는 보고도 시작 시각이 있으면 같은 규칙 — 보고 시각은 보지 않는다.
    assertThat(
            AgentRuntimeSlotRepository.isOldPodReport(
                "  ", cur.minusSeconds(31), cur, "p1", cur, basis))
        .isTrue();
    // ② 지금 Pod 시작을 모르면 시작 시각으로는 가를 수 없다.
    assertThat(
            AgentRuntimeSlotRepository.isOldPodReport(
                null, cur.minusDays(1), null, null, null, basis))
        .isFalse();
    // ③ 같은 정체 + 시작 시각 없음 — 보고 시각이 기준보다 한참 일러도 옛 것이 아니다(API 시계와 노드 시계를 견주지 않는다).
    assertThat(
            AgentRuntimeSlotRepository.isOldPodReport(
                "p1", null, basis.minusDays(1), "p1", cur, basis))
        .isFalse();
    // ④ 정체를 모르고 시작 시각도 없으면 보고 시각을 시각 없는 기준 cutoff 와 견준다 — 지금 Pod 시작(cur)이 아니라 basis 다.
    assertThat(
            AgentRuntimeSlotRepository.isOldPodReport(
                null, null, basis.minusSeconds(31), null, cur, basis))
        .isTrue();
    assertThat(
            AgentRuntimeSlotRepository.isOldPodReport(
                null, null, basis.minusSeconds(30), null, cur, basis))
        .isFalse();
    assertThat(
            AgentRuntimeSlotRepository.isOldPodReport(
                "p1", null, cur.minusSeconds(60), null, cur, basis))
        .isFalse();
    // ④ 기준이나 보고 시각을 모르면 옛 것이 아니다.
    assertThat(
            AgentRuntimeSlotRepository.isOldPodReport(
                null, null, basis.minusDays(1), null, cur, null))
        .isFalse();
    assertThat(AgentRuntimeSlotRepository.isOldPodReport(null, null, null, null, cur, basis))
        .isFalse();
  }

  /**
   * 같은 정체의 칸(WP-2010 최종 리뷰 F1·R2) — 시작 시각을 실은 칸은 같은 Pod 안 컨테이너 재시작이라 지금 Pod 시작과 견줘 뺀다. 시각 없는 같은 정체
   * 칸은 보고 시각(API 시계)을 노드 시계 기준과 견주지 않으므로 남는다(R2 ③ — 빠른 노드 시계에서 지금 칸이 지워지지 않게). 메모리 거르기와 SQL 지우기가
   * 같다.
   */
  @Test
  void samePodUid_containerRestart_dropsEarlierContainerSlotsByTime() {
    OffsetDateTime cur = T2;
    slots.upsert(
        agent, "OLD", WORKING, "OLD-1", null, cur.minusSeconds(55), cur.minusSeconds(60), "pod-a");
    slots.upsert(agent, "NEAR", WORKING, "NEAR-1", null, cur, cur.minusSeconds(29), "pod-a");
    slots.upsert(agent, "TL_OLD", WORKING, "T-1", null, cur.minusSeconds(31), null, "pod-a");
    slots.upsert(agent, "TL_NEW", WORKING, "T-2", null, cur.plusSeconds(5), null, "pod-a");

    // 메모리 판정과 SQL 이 같은 칸을 가른다(둘이 갈리면 지우고도 읽기에서 다시 걸러 칸이 남는다).
    List<String> memoryOld =
        slots.findAll(agent).stream()
            .filter(s -> AgentRuntimeSlotRepository.isFromOldPod(s, "pod-a", cur, cur))
            .map(Slot::slotKey)
            .toList();
    assertThat(memoryOld).containsExactly("OLD");
    assertThat(
            slots.deleteReportedBeforePodStart(
                Map.of(agent, new PodStarts(cur, cur, "pod-a")), null))
        .containsExactly(agent);
    assertThat(keysOf(agent)).containsExactlyInAnyOrder("NEAR", "TL_OLD", "TL_NEW");
  }

  /**
   * 메모리 판정(isFromOldPod)과 SQL 지우기(deleteReportedBeforePodStart)가 같은 칸을 고른다(WP-2010 R2) — 칸
   * 정체(같음·다름·모름) × 칸 시작 시각(있음·없음) × 보고 시각(관찰 기준 앞·뒤)의 모든 조합을 지금 정체를 아는 경우와 모르는 경우로 견준다.
   */
  @Test
  void oldPodRule_memoryAndSqlAgreeAcrossIdentityAndTime() {
    OffsetDateTime observed = T0;
    OffsetDateTime current = T2;
    for (String currentUid : java.util.Arrays.asList("pod-a", null)) {
      dsl.deleteFrom(com.workplace.jooq.Tables.AGENT_RUNTIME_SLOT_STATE).execute();
      int n = 0;
      for (String uid : java.util.Arrays.asList("pod-a", "pod-b", null)) {
        for (OffsetDateTime podStart :
            java.util.Arrays.asList(current.minusSeconds(60), current.minusSeconds(10), null)) {
          for (OffsetDateTime reportedAt :
              List.of(observed.minusSeconds(60), observed.minusSeconds(10))) {
            slots.upsert(agent, "S" + (n++), WORKING, null, null, reportedAt, podStart, uid);
          }
        }
      }
      List<String> memoryOld =
          slots.findAll(agent).stream()
              .filter(
                  s -> AgentRuntimeSlotRepository.isFromOldPod(s, currentUid, observed, current))
              .map(Slot::slotKey)
              .sorted()
              .toList();
      List<String> all = keysOf(agent);
      slots.deleteReportedBeforePodStart(
          Map.of(agent, new PodStarts(observed, current, currentUid)), null);
      List<String> remaining = keysOf(agent);
      List<String> sqlDeleted = all.stream().filter(k -> !remaining.contains(k)).toList();
      assertThat(sqlDeleted).as("지금 정체 %s", currentUid).isEqualTo(memoryOld);
      assertThat(memoryOld).isNotEmpty();
    }
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
    slots.upsert(agent, "WP", WORKING, "WP-1", null, T0, T2, null);
    assertThat(slots.findAll(agent).get(0).podStartedAt().toInstant()).isEqualTo(T2.toInstant());
    slots.upsert(agent, "WP", WORKING, "WP-1", null, T1, null, null);
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

  /**
   * 보고 정체를 지금까지 알던 정체와 견본다(WP-1968 반려 ①) — 지금과 같으면 MATCH, 바로 앞이면 OTHER(끝나는 중인 옛 Pod), 그 밖이면
   * ADOPT(재시작 직후 새 Pod 가 밝힌 정체 — 관찰을 기다리지 않고 지금 Pod 로 받는다), 아직 정체를 몰랐으면 첫 인식이라 ADOPT.
   */
  @Test
  void podIdentity_comparesAgainstCurrentAndPrevious() {
    assertThat(AgentRuntimeSlotRepository.podIdentity("pod-a", "pod-a", null, null, null))
        .isEqualTo(PodIdentity.MATCH);
    assertThat(AgentRuntimeSlotRepository.podIdentity("pod-a", "pod-a", "pod-old", null, null))
        .isEqualTo(PodIdentity.MATCH);
    // 재시작 직후 — 관찰이 아직 옛 정체를 가리키는 동안에도 새 Pod 의 첫 보고는 지금 Pod 로 받는다(①). 보고에 실은 Pod 시작(T2)이
    // 지금 알던 시작(T0)보다 늦어야만 받는다(C1 — 더 이른 정체는 두 세대 넘게 지연된 옛 Pod 라 받지 않는다).
    assertThat(AgentRuntimeSlotRepository.podIdentity("pod-b", "pod-a", null, T2, T0))
        .isEqualTo(PodIdentity.ADOPT);
    // 끝나는 중인 옛 Pod 의 늦은 보고 — 지금도 바로 앞도 아니라야 한다(지금 Pod 가 밝힌 정체를 곧바로 옛 Pod 로 뒤집지 않기 위해).
    assertThat(AgentRuntimeSlotRepository.podIdentity("pod-a", "pod-b", "pod-a", null, null))
        .isEqualTo(PodIdentity.OTHER);
    // 아직 한 번도 관찰·보고받지 못함 — 시작 시각이 있으면 첫 인식으로 받되(⑥) 상태는 비우지 않도록 서비스가 따로 본다.
    assertThat(AgentRuntimeSlotRepository.podIdentity("pod-a", null, null, T2, null))
        .isEqualTo(PodIdentity.ADOPT);
    // 시각 없는 첫 보고는 ADOPT 하지 않는다(6차 반려 ①) — 아래 {@link
    // #podIdentity_firstIdentificationRequiresStart()} 참고.
    assertThat(AgentRuntimeSlotRepository.podIdentity("pod-a", null, null, null, null))
        .isEqualTo(PodIdentity.OTHER);
    assertThat(AgentRuntimeSlotRepository.podIdentity(null, "pod-a", null, null, null))
        .isEqualTo(PodIdentity.UNKNOWN);
    assertThat(AgentRuntimeSlotRepository.podIdentity(null, null, null, null, null))
        .isEqualTo(PodIdentity.UNKNOWN);
  }

  /**
   * 정체가 곧 지금 Pod 인지 시작 시각으로 한 번 더 가른다(WP-1968 반려 C1·2차 반려 ④) — 지금 알던 Pod 시작보다 30초 넘게 이른 정체는 두 세대 넘게
   * 지연돼 도착한 옛 Pod 라 새로 받으면 정체가 과거로 되돌아가, 살아 있는 지금 Pod 가 previous 로 남아 영원히 OTHER(상태 미저장·칸 409·관찰
   * 필터)가 된다. 관찰(약 60초)이 정체를 밝히면 MATCH 로 잇는다. 여유를 두는 이유는 죽은 빠른 시계 Pod 가 올려 둔 부풀린 기준에 25초 빠른 정상 새 Pod
   * 보고가 걸려 관찰까지 OTHER 로 버려지지 않게 하기 위함이다(2차 반려 ④).
   */
  @Test
  void podIdentity_olderPodStartIsNotAdopted() {
    // 지금 Pod(pod-b, 시작 T2)를 아는 상태에서 두 세대 전 정체(pod-a, 시작 T0)의 늦은 보고가 온다 — 받아들이지 않는다.
    assertThat(AgentRuntimeSlotRepository.podIdentity("pod-a", "pod-b", "pod-c", T0, T2))
        .isEqualTo(PodIdentity.OTHER);
    // 죽은 빠른 시계 Pod 가 기준을 25초 부풀려 둔 상태의 정상 새 Pod 보고 — 시계 차이 여유(30초) 안이라 그대로 받는다(2차 반려 ④).
    assertThat(
            AgentRuntimeSlotRepository.podIdentity(
                "pod-new", "pod-b", null, T2.minusSeconds(25), T2))
        .isEqualTo(PodIdentity.ADOPT);
    assertThat(
            AgentRuntimeSlotRepository.podIdentity(
                "pod-new", "pod-b", null, T2.minusSeconds(31), T2))
        .isEqualTo(PodIdentity.OTHER);
    // 지금 알던 Pod 시작을 아직 모르면(비어 있음) 견딜 것이 없어 그대로 받는다.
    assertThat(AgentRuntimeSlotRepository.podIdentity("pod-new", "pod-b", null, T0, null))
        .isEqualTo(PodIdentity.ADOPT);
    // 재시작 직후 새 Pod — 시작이 지금 알던 것보다 늦으면(같으면) 그대로 받는다.
    assertThat(AgentRuntimeSlotRepository.podIdentity("pod-new", "pod-b", null, T2, T0))
        .isEqualTo(PodIdentity.ADOPT);
    assertThat(AgentRuntimeSlotRepository.podIdentity("pod-new", "pod-b", null, T2, T2))
        .isEqualTo(PodIdentity.ADOPT);
  }

  /**
   * 시각이 걸러진(null) 모르는 정체는 ADOPT 하지 않는다(WP-1968 2차 반려 ②) — acceptedPodStart 가 서버 시계보다 30초 넘게 앞선 시작을
   * null 로 바꾸므로, 빠른 시계 노드의 죽은 옛 Pod 늦은 보고가 검사 없이 ADOPT 돼 정체를 과거로 되돌리면 살아 있는 Pod 가 영원히 previous 로 남는
   * 교착(상태 버림·칸 409 무한)이 생기고 WP-1958 보호도 사라진다. 관찰(약 60초)이 정체를 밝힌 뒤 MATCH 로 잇는다.
   */
  @Test
  void podIdentity_timelessUnknownIdentityIsNotAdopted() {
    // 지금 정체를 아는 동안, 시작 시각 없는 모르는 정체는 버린다.
    assertThat(AgentRuntimeSlotRepository.podIdentity("pod-new", "pod-b", null, null, T2))
        .isEqualTo(PodIdentity.OTHER);
    // 지금 Pod 시작도 모르는 경우(둘 다 없음)도 같다 — 정체를 아는 동안엔 시각 없는 정체를 믿지 않는다.
    assertThat(AgentRuntimeSlotRepository.podIdentity("pod-new", "pod-b", null, null, null))
        .isEqualTo(PodIdentity.OTHER);
    // 보고에 시각이 있으면(걸러지지 않았으면) 그대로 ADOPT — 재시작 직후 새 Pod 가 관찰을 기다리지 않고 받아진다.
    assertThat(AgentRuntimeSlotRepository.podIdentity("pod-new", "pod-b", null, T2, T0))
        .isEqualTo(PodIdentity.ADOPT);
    // 시각 없는 보고는 첫 인식(정체를 아직 모르던 경우)도 ADOPT 하지 않는다(6차 반려 ①) — 기준 없이 박힌 정체가
    // 그 뒤 옛 Pod 의 ADOPT 에 previous 로 남아 살아 있는 Pod 을 영구 OTHER 로 만들기 때문이다.
    assertThat(AgentRuntimeSlotRepository.podIdentity("pod-new", null, null, null, null))
        .isEqualTo(PodIdentity.OTHER);
    assertThat(AgentRuntimeSlotRepository.podIdentity("pod-new", null, null, null, T2))
        .isEqualTo(PodIdentity.OTHER);
    // 바로 앞 정체(끝나는 중 옛 Pod)·지금 정체는 시각과 무관하게 그대로(OTHER·MATCH).
    assertThat(AgentRuntimeSlotRepository.podIdentity("pod-old", "pod-b", "pod-old", null, T2))
        .isEqualTo(PodIdentity.OTHER);
    assertThat(AgentRuntimeSlotRepository.podIdentity("pod-b", "pod-b", null, null, T2))
        .isEqualTo(PodIdentity.MATCH);
  }

  /**
   * 정체를 몰라도(observed 비어 있어도) 지금 알던 시작보다 이른 정체는 ADOPT 하지 않는다(WP-1968 3차 반려 ③) — 첫 인식 ADOPT 가 시각 검사보다
   * 먼저 나오면, 배포 직후 옛 Pod 의 늦은 보고가 ADOPT 로 받아져 `started_at` 을 그 옛 Pod 값으로 되돌린다. 첫 인식은 시각이 있는 보고일
   * 때만다(6차 반려 ①) — 시각 없는 첫 보고는 ADOPT 하지 않는다.
   */
  @Test
  void podIdentity_observedEmptyStillRejectsOlderPod() {
    // 관찰 전이어도 지금 알던 시작(T2)보다 30초 넘게 이른 정체(T0)는 옛 Pod — ADOPT 하지 않는다.
    assertThat(AgentRuntimeSlotRepository.podIdentity("pod-old", null, null, T0, T2))
        .isEqualTo(PodIdentity.OTHER);
    // 같거나 늦은 시작은 첫 인식으로 그대로 받는다.
    assertThat(AgentRuntimeSlotRepository.podIdentity("pod-new", null, null, T2, T2))
        .isEqualTo(PodIdentity.ADOPT);
    assertThat(
            AgentRuntimeSlotRepository.podIdentity("pod-new", null, null, T2.minusSeconds(25), T2))
        .isEqualTo(PodIdentity.ADOPT);
    // 시각이 없는 첫 보고는 첫 인식이어도 받지 않는다(6차 반려 ①) — isOlderPod 는 null 에서 거짓이라 시각 검사로는 걸리지 않는다.
    assertThat(AgentRuntimeSlotRepository.podIdentity("pod-new", null, null, null, T2))
        .isEqualTo(PodIdentity.OTHER);
    assertThat(AgentRuntimeSlotRepository.podIdentity("pod-new", null, null, null, null))
        .isEqualTo(PodIdentity.OTHER);
  }

  /**
   * 첫 인식도 시작 시각을 요구한다(WP-1968 6차 반려 ①) — 시각 없이 ADOPT 하면 그 인식이 기준 없이 박히고, 그 뒤 옛 Pod A 가 시각을 실어 다시
   * ADOPT 하면 observed=A·previous=B 로 박혀 살아 있는 Pod B 는 영구 OTHER(상태 미저장·칸 409)가 된다(이 이슈의 시계가 앞선 경우
   * 그대로). 시각으로 첫 인식을 막으면 정체가 시각과 함께 박혀 B 가 회복한다.
   */
  @Test
  void podIdentity_firstIdentificationRequiresStart() {
    // 정체를 아직 모르는 첫 보고 — 시작 시각이 없으면 ADOPT 하지 않는다.
    assertThat(AgentRuntimeSlotRepository.podIdentity("pod-b", null, null, null, null))
        .isEqualTo(PodIdentity.OTHER);
    assertThat(AgentRuntimeSlotRepository.podIdentity("pod-b", null, null, null, T2))
        .isEqualTo(PodIdentity.OTHER);
    // 시작 시각이 있으면 첫 인식으로 그대로 받는다(정체가 과거로 박히지 않는다).
    assertThat(AgentRuntimeSlotRepository.podIdentity("pod-b", null, null, T2, null))
        .isEqualTo(PodIdentity.ADOPT);
    assertThat(AgentRuntimeSlotRepository.podIdentity("pod-b", null, null, T2, T0))
        .isEqualTo(PodIdentity.ADOPT);

    // 교착 흐름 — 시각 없는 첫 보고는 정체를 못 박지 않으므로, 그 뒤 옛 Pod A 의 보고가 첫 인식이 되어 previous 가 비어 있다.
    Row first = settings.find(agent).orElseThrow();
    assertThat(
            AgentRuntimeSlotRepository.podIdentity(
                "pod-b", first.observedPodUid(), first.previousPodUid(), null, null))
        .isEqualTo(PodIdentity.OTHER);
    Row adoptedA = settings.adoptPodIdentity(first, "pod-a", T0);
    assertThat(adoptedA.previousPodUid()).isNull();

    // 살아 있는 B 가 시각과 함께 보고한다 — previous 가 A 라 교착 없이 ADOPT 로 정체를 되찾는다.
    assertThat(
            AgentRuntimeSlotRepository.podIdentity(
                "pod-b",
                adoptedA.observedPodUid(),
                adoptedA.previousPodUid(),
                T2,
                adoptedA.startedAt()))
        .isEqualTo(PodIdentity.ADOPT);
    Row alive = settings.adoptPodIdentity(adoptedA, "pod-b", T2);
    assertThat(alive.observedPodUid()).isEqualTo("pod-b");
    assertThat(alive.previousPodUid()).isEqualTo("pod-a");
    assertThat(
            AgentRuntimeSlotRepository.podIdentity(
                "pod-b", alive.observedPodUid(), alive.previousPodUid(), T2, alive.startedAt()))
        .isEqualTo(PodIdentity.MATCH);
    assertThat(
            AgentRuntimeSlotRepository.podIdentity(
                "pod-a", alive.observedPodUid(), alive.previousPodUid(), T0, alive.startedAt()))
        .isEqualTo(PodIdentity.OTHER);
  }

  /**
   * 빈 문자열 정체는 null 과 같은 뜻으로 다뤄 UNKNOWN 이다(WP-1968) — 공백뿐인 정체를 OTHER 로 보면 지금 Pod 의 보고가 거절되고, 둘 다 비면
   * MATCH 로 시각 검사 없이 받아진다. 옛 이미지처럼 시각 규칙으로 가르도록 한다. 단 지금 정체를 아직 모르는 동안의 보고도 시작 시각이 있어야 ADOPT 다(6차
   * 반려 ①) — 시각 없는 보고는 UNKNOWN 이 아니고 ADOPT 도 아니라 OTHER 다.
   */
  @Test
  void podIdentity_blankTreatedAsUnknown() {
    assertThat(AgentRuntimeSlotRepository.podIdentity("", "pod-a", null, null, null))
        .isEqualTo(PodIdentity.UNKNOWN);
    assertThat(AgentRuntimeSlotRepository.podIdentity("pod-a", "", null, T0, null))
        .isEqualTo(PodIdentity.ADOPT);
    assertThat(AgentRuntimeSlotRepository.podIdentity("pod-a", "", null, null, T0))
        .isEqualTo(PodIdentity.OTHER);
    assertThat(AgentRuntimeSlotRepository.podIdentity("", "", null, null, null))
        .isEqualTo(PodIdentity.UNKNOWN);
    assertThat(AgentRuntimeSlotRepository.podIdentity(" ", "pod-a", null, null, null))
        .isEqualTo(PodIdentity.UNKNOWN);
    assertThat(AgentRuntimeSlotRepository.podIdentity("pod-a", "\t\n", null, T0, null))
        .isEqualTo(PodIdentity.ADOPT);
    assertThat(AgentRuntimeSlotRepository.podIdentity("pod-a", "\t\n", null, null, null))
        .isEqualTo(PodIdentity.OTHER);
    assertThat(AgentRuntimeSlotRepository.podIdentity("  ", "  ", null, null, null))
        .isEqualTo(PodIdentity.UNKNOWN);
    // 공백이 아닌 실제 정체끼리의 판정은 그대로다.
    assertThat(AgentRuntimeSlotRepository.podIdentity("pod-a", "pod-a", null, null, null))
        .isEqualTo(PodIdentity.MATCH);
    assertThat(AgentRuntimeSlotRepository.podIdentity("", null, null, null, null))
        .isEqualTo(PodIdentity.UNKNOWN);
  }

  /** 정체가 같은 보고의 기준은 그대로 쓴다 — 올리기만 하는 raise 와 달리 내려 덮어쓰고, null 은 칸을 비운다(WP-1968 · 작업 5 계약). */
  @Test
  void setReportedPodStart_writesAsIsAndClearsOnNull() {
    settings.raiseReportedPodStart(agent, T2);
    settings.setReportedPodStart(agent, T1);
    assertThat(settings.find(agent).orElseThrow().reportedPodStartedAt().toInstant())
        .isEqualTo(T1.toInstant());

    settings.setReportedPodStart(agent, null);
    assertThat(settings.find(agent).orElseThrow().reportedPodStartedAt()).isNull();
  }

  private void observe(OffsetDateTime startedAt) {
    Row row = settings.find(agent).orElseThrow();
    long location = row.locationId() == null ? 0L : row.locationId();
    settings.updateObserved(
        location,
        true,
        List.of(
            new RunnerObservedAgent(
                agent, null, "RUNNING", null, null, null, startedAt, null, null)));
  }

  /** runner 가 관찰한 started_at 이 보고한 Pod 시작보다 30초 넘게 늦으면 보고한 값을 비운다 — 더 이른 값이면 그대로(WP-1958). */
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

  /** 보고값이 관찰값보다 시계 여유(30초) 안에서 앞서면 비우지 않는다 — 경계 30초는 안이다(WP-1958). */
  @Test
  void updateObserved_withinGrace_keepsReportedPodStart() {
    observe(T1);
    settings.raiseReportedPodStart(agent, T1.minusSeconds(30));

    observe(T1);

    assertThat(settings.find(agent).orElseThrow().reportedPodStartedAt().toInstant())
        .isEqualTo(T1.minusSeconds(30).toInstant());
  }

  /** 보고값이 관찰값보다 여유를 넘게(31초) 앞서면 시작 시각이 그대로여도 비운다(WP-1958). */
  @Test
  void updateObserved_beyondGrace_clearsReportedPodStart() {
    observe(T1);
    settings.raiseReportedPodStart(agent, T1.minusSeconds(31));

    observe(T1);

    assertThat(settings.find(agent).orElseThrow().reportedPodStartedAt()).isNull();
  }

  /** runner 가 순간적으로 started_at 을 null 로 보고(STARTING 등)해도 보고한 Pod 시작 시각은 비우지 않는다. */
  @Test
  void updateObserved_nullStartedAt_keepsReportedPodStart() {
    observe(T0);
    settings.raiseReportedPodStart(agent, T2);

    observe(null);

    assertThat(settings.find(agent).orElseThrow().reportedPodStartedAt()).isNotNull();
  }

  /**
   * 새 Pod 관찰이 마지막 상태 보고 시각을 비울 때 그 보고의 Pod 정체도 함께 비운다(WP-2010 최종 리뷰 F3) — 시각만 비고 정체가 남으면 다음 합치기 전까지
   * 적용 판정이 짝이 맞지 않는 값을 읽는다.
   */
  @Test
  void updateObserved_newPodClearsReportedPodUidWithReportedAt() {
    observe(T0);
    settings.writeAgentState(
        agent, WORKING, List.of("WP-1"), T1, T0.plusMinutes(1), "pod-a", T0.plusSeconds(5));
    assertThat(settings.find(agent).orElseThrow().agentReportedPodUid()).isEqualTo("pod-a");

    observe(T2);

    Row row = settings.find(agent).orElseThrow();
    assertThat(row.agentReportedAt()).isNull();
    assertThat(row.agentReportedPodUid()).isNull();
    assertThat(row.agentReportedPodStartedAt()).isNull();
  }

  /**
   * 새 Pod 관찰 뒤에 도착한 옛 Pod 정체의 늦은 상태 보고는 새 Pod 의 보고로 남기지 않는다(WP-2010 R4) — 보고 시각이 새 Pod 시작보다 늦어도 그
   * 보고의 정체가 새로 관찰한 정체와 다르면 지운다. 정체가 같으면(새 Pod 의 보고) 그대로 남는다.
   */
  @Test
  void updateObserved_newPodClearsLateReportFromOtherIdentity() {
    observeWithUid(T0, "pod-a");
    // 옛 Pod(pod-a)의 늦은 보고 — 받은 시각은 새 Pod 시작(T1) 뒤다.
    settings.writeAgentState(agent, WORKING, List.of("WP-1"), null, T1.plusMinutes(1), "pod-a", T0);

    Row row = observeWithUid(T1, "pod-b").get(agent).row();

    assertThat(row.agentState()).isNull();
    assertThat(row.agentReportedAt()).isNull();
    assertThat(row.agentReportedPodUid()).isNull();
  }

  /** 새 Pod 정체가 낸 보고(새 Pod 시작 뒤)는 새 Pod 관찰이 지우지 않는다(WP-2010 R4 의 반대쪽). */
  @Test
  void updateObserved_newPodKeepsReportFromNewIdentity() {
    observeWithUid(T0, "pod-a");
    settings.writeAgentState(agent, WORKING, List.of("WP-1"), null, T1.plusMinutes(1), "pod-b", T1);

    Row row = observeWithUid(T1, "pod-b").get(agent).row();

    assertThat(row.agentState()).isEqualTo("WORKING");
    assertThat(row.agentReportedPodUid()).isEqualTo("pod-b");
  }

  /** 진입점 차단 보고에 Pod 시작 시각을 함께 저장하고, 차단이 풀리면(message null) 비운다. */
  @Test
  void updatePaneBlocked_storesAndClearsPodStart() {
    settings.updatePaneBlocked(agent, "막힘", T1, null, T2, "pod-b");
    Row blocked = settings.find(agent).orElseThrow();
    assertThat(blocked.paneBlockedPodStartedAt().toInstant()).isEqualTo(T2.toInstant());
    assertThat(blocked.paneBlockedPodUid()).isEqualTo("pod-b");

    settings.updatePaneBlocked(agent, null, null, null, T2, "pod-b");
    Row cleared = settings.find(agent).orElseThrow();
    assertThat(cleared.paneBlockedPodStartedAt()).isNull();
    assertThat(cleared.paneBlockedPodUid()).isNull();
  }

  /** 지금 정체·바로 앞 정체를 직접 심는다 — 재시작 직후 상황을 재현하기 위해(WP-1968 반려 ①·②). */
  private void seedIdentity(String observed, String previous, OffsetDateTime startedAt) {
    dsl.update(AGENT_RUNTIME_SETTING)
        .set(AGENT_RUNTIME_SETTING.OBSERVED_POD_UID, observed)
        .set(AGENT_RUNTIME_SETTING.PREVIOUS_POD_UID, previous)
        .set(AGENT_RUNTIME_SETTING.STARTED_AT, startedAt)
        .where(AGENT_RUNTIME_SETTING.AGENT_USER_ID.eq(agent))
        .execute();
  }

  /** runner 관찰 한 건을 정체와 함께 보낸다 — 관찰이 정체를 되돌리는지 확인하기 위해(WP-1968 반려 ②). */
  private Map<Long, AgentRuntimeSettingRepository.ObservedUpdate> observeWithUid(
      OffsetDateTime startedAt, String podUid) {
    return observeWithUid(startedAt, podUid, "RUNNING");
  }

  /** runner 관찰 한 건을 정체·phase 와 함께 보낸다 — 끝나는 중인 옛 Pod 관찰을 재현하기 위해(WP-1968 2차 반려 ①). */
  private Map<Long, AgentRuntimeSettingRepository.ObservedUpdate> observeWithUid(
      OffsetDateTime startedAt, String podUid, String phase) {
    Row row = settings.find(agent).orElseThrow();
    long location = row.locationId() == null ? 0L : row.locationId();
    return settings.updateObserved(
        location,
        true,
        List.of(
            new RunnerObservedAgent(
                agent, null, phase, null, null, null, startedAt, null, podUid)));
  }

  /**
   * 정체가 다른 칸은 시각과 무관하게 옛 Pod 칸이다(WP-1968 반려 ③·WP-2010) — 노드 시계가 빠른 죽은 Pod 가 지금보다 **뒤**인 시작 시각을 들고
   * 있어도, 정체가 다르면 옛 Pod 칸이라 메모리 거르기와 SQL 지우기가 같이 지운다. 정체를 모르는 칸(옛 플러그인)은 지금까지의 시각 규칙 그대로다.
   */
  @Test
  void slotPodUid_filtersOldPodByIdentityNotByClock() {
    // 지금 Pod 시작(T0)보다 뒤인 시작 시각을 가진 옛 Pod 칸 — 시계 판정으로는 지금 Pod 칸으로 남는다.
    Slot oldFast = new Slot("OLD", WORKING, "OLD-1", null, T2, T2, "pod-old");
    Slot mine = new Slot("NEW", WORKING, "NEW-1", null, T2, T0, "pod-new");
    assertThat(AgentRuntimeSlotRepository.isFromOldPod(oldFast, "pod-new", T2, T0)).isTrue();
    assertThat(AgentRuntimeSlotRepository.isFromOldPod(mine, "pod-new", T2, T0)).isFalse();
    // 정체를 모르는 동안엔 시각 규칙으로 그대로 가른다.
    assertThat(AgentRuntimeSlotRepository.isFromOldPod(oldFast, null, T2, T0)).isFalse();

    slots.upsert(agent, "OLD", WORKING, "OLD-1", null, T2, T2, "pod-old");
    slots.upsert(agent, "NEW", WORKING, "NEW-1", null, T2, T0, "pod-new");

    // 메모리 거르기가 옛 칸 하나를 잡아야 SQL 도 같은 칸만 지운다(둘이 갈리면 칸이 남는다).
    List<Slot> all = slots.findAll(agent);
    assertThat(
            all.stream().filter(s -> AgentRuntimeSlotRepository.isFromOldPod(s, "pod-new", T2, T0)))
        .hasSize(1);
    assertThat(
            slots.deleteReportedBeforePodStart(
                Map.of(agent, new PodStarts(T2, T0, "pod-new")), null))
        .containsExactly(agent);
    assertThat(keysOf(agent)).containsExactly("NEW");
  }

  /**
   * 끝나는 중인 옛 Pod 를 늦게 관찰해도 지금 정체·시각·기준을 되돌리지 않는다(WP-1968 반려 ②) — 관찰이 밀려 도착해 옛 정체로 적히면, 그 옛 Pod 의 시작
   * 시각이 기준이 되어 지금 Pod 의 보고가 영영 옛 Pod 로 오판된다.
   */
  @Test
  void updateObserved_stalePodObservationKeepsCurrentIdentity() {
    seedIdentity("pod-new", "pod-old", T0);
    settings.raiseReportedPodStart(agent, T0);

    // 지금 Pod 정체를 이미 아는 상태에서, 지난 정체(pod-old)의 관찰이 늦게 도착한다 — 아예 받지 않는다.
    assertThat(observeWithUid(T2, "pod-old")).isEmpty();

    Row row = settings.find(agent).orElseThrow();
    assertThat(row.observedPodUid()).isEqualTo("pod-new");
    assertThat(row.previousPodUid()).isEqualTo("pod-old");
    assertThat(row.startedAt().toInstant()).isEqualTo(T0.toInstant());
    assertThat(row.reportedPodStartedAt().toInstant()).isEqualTo(T0.toInstant());
    assertThat(row.agentState()).isNull();
  }

  /**
   * 배포 뒤 첫 관찰(정체 없음 → 정체)은 새 Pod 로 세지 않고 지난 상태를 그대로 둔다(WP-1968 반려 ⑥) — 새 컬럼의 값이 아직 없어 모든 AI 를 「새
   * Pod」로 오판하면 시작 직후 차단·작업 상태가 한 번에 비워졌다. 정체만 적고 시작 시각·phase 가 그대로면 상태를 지우지 않는다.
   */
  @Test
  void updateObserved_firstObservationKeepsAgentState() {
    observe(T0); // 지금까지의 관찰 — 정체 칸은 아직 비어 있다(배포 전처럼)
    settings.writeAgentState(agent, WORKING, List.of("WP-1"), T1, OffsetDateTime.now(), null, null);

    Row row = observeWithUid(T0, "pod-a").get(agent).row();

    assertThat(row.observedPodUid()).isEqualTo("pod-a");
    assertThat(row.previousPodUid()).isNull();
    assertThat(row.agentState()).isEqualTo("WORKING");
    assertThat(row.agentIssueKeys()).containsExactly("WP-1");
  }

  /**
   * 정체가 같은 관찰은 시작 시각이 달라도(칸 보고가 대신 적어 둔 근사값 vs k8s 정확 시각) 새 Pod 로 세지 않는다(WP-1968 반려 ⑥ — 관찰과 보고가 엇갈려
   * 지난 상태가 되풀이로 비워지지 않게). 정체를 이미 밝힌 뒤의 관찰이라 ADOPT 로 정체가 되돌아가지도 않는다(C1).
   */
  @Test
  void updateObserved_sameIdentityWithDifferentStartKeepsAgentState() {
    observeWithUid(T2, "pod-a"); // 지금 정체를 이미 밝혔다(정체만 적은 첫 보고)
    settings.writeAgentState(agent, WORKING, List.of("WP-1"), T1, OffsetDateTime.now(), null, null);

    // 같은 정체, 다른 시작 시각 — runner 가 정확한 Pod 시작을 다시 알린 것이다.
    Row row = observeWithUid(T1, "pod-a").get(agent).row();

    assertThat(row.observedPodUid()).isEqualTo("pod-a");
    assertThat(row.previousPodUid()).isNull();
    assertThat(row.startedAt().toInstant()).isEqualTo(T1.toInstant());
    assertThat(row.agentState()).isEqualTo("WORKING");
    assertThat(row.agentIssueKeys()).containsExactly("WP-1");
  }

  /**
   * 배포 직후 롤링 재시작 — 새 Pod B 보고가 ADOPT 로 정체를 채운 뒤(previous 는 비어 있음) 늦게 도착한 옛 Pod A 관찰이 정체를 뒤집지
   * 않는다(WP-1968 2차 반려 ①) — 뒤집히면 observed=A·previous=B 가 돼 B 의 보고는 영영 OTHER(상태 버림·칸 409 무한)이고, B 관찰은
   * previous=B 라 stale 로 걸려 스스로 회복되지 않는다.
   */
  @Test
  void updateObserved_adoptedIdentityIsNotDemotedByOlderPodObservation() {
    // 배포 직후 — 정체가 아직 비어 있다. 새 Pod B 의 첫 보고가 ADOPT 로 정체를 밝힌다(previous 는 비어 있고 시작만 B 의 것으로 바뀐다).
    Row adopted = settings.adoptPodIdentity(settings.find(agent).orElseThrow(), "pod-b", T2);
    assertThat(adopted.observedPodUid()).isEqualTo("pod-b");
    assertThat(adopted.previousPodUid()).isNull();

    // 아직 끝나는 중인 옛 Pod A 를 늦게 관찰한다 — 시작 시각이 이르므로 지난 정체라 아예 받지 않는다.
    assertThat(observeWithUid(T0, "pod-a")).isEmpty();

    Row row = settings.find(agent).orElseThrow();
    assertThat(row.observedPodUid()).isEqualTo("pod-b");
    assertThat(row.previousPodUid()).isNull();
    assertThat(row.startedAt().toInstant()).isEqualTo(T2.toInstant());
    // 뒤집혔다면 B 의 보고는 OTHER 로 영구 교착 — 정체가 그대로라 MATCH 로 이어진다.
    assertThat(
            AgentRuntimeSlotRepository.podIdentity(
                "pod-b", row.observedPodUid(), row.previousPodUid(), T2, row.startedAt()))
        .isEqualTo(PodIdentity.MATCH);
    // 걸러낸 게 아니라 행이 아예 없다는 뜻이 아님을 — B 의 관찰은 그대로 받아진다.
    assertThat(observeWithUid(T2, "pod-b")).containsKey(agent);
    assertThat(settings.find(agent).orElseThrow().observedPodUid()).isEqualTo("pod-b");
  }

  /**
   * 끝나는 중인 옛 Pod 관찰은 previous 가 비어 있어도 지난 정체다(WP-1968 2차 반려 ①) — 시작 시각이 지금과 같아 시계로는 잡히지 않아도, 끝나는
   * 중(STOPPING·STOPPED·시작이 이르지 않은 FAILED) 정체가 다른 관찰은 지금 Pod 정체를 되돌리지 않는다. 끝나지 않은 정체가 다른 관찰(정체를 밝히는
   * 첫 관찰)은 그대로 받아 정체를 갈아끼운다. 시작이 뒤인(새로 뜬)FAILED 는 갈아끼운다(3차 반려 ① — 아래 {@link
   * #updateObserved_firstObservedFailedPodIsNotStale()}).
   */
  @Test
  void updateObserved_endingOldPodObservationIsStaleWithoutPrevious() {
    seedIdentity("pod-b", null, T2);

    assertThat(observeWithUid(T2, "pod-a", "STOPPED")).isEmpty();
    assertThat(observeWithUid(T2, "pod-a", "STOPPING")).isEmpty();
    assertThat(observeWithUid(T2, "pod-a", "FAILED")).isEmpty();

    Row row = observeWithUid(T2, "pod-a", "RUNNING").get(agent).row();
    assertThat(row.observedPodUid()).isEqualTo("pod-a");
    assertThat(row.previousPodUid()).isEqualTo("pod-b");
  }

  /**
   * 새로 뜬 실패 Pod 의 관찰은 지난 정체가 아니다(WP-1968 3차 반려 ①) — FAILED 를 무조건 끝나는 중 phase 로 넣어 두면
   * ImagePullBackOff 같은 새 Pod 의 FAILED 관찰이 매번 버려져 「오류」가 화면에 안 뜬다. 다만 시작이 지금 알던 시작보다 이르거나 같거나 모르는
   * FAILED 관찰은 끝나는 중인 옛 Pod 라 previous 가 비어 있어도 그대로 지난 정체다(2차 반려 ① 교착 창).
   */
  @Test
  void updateObserved_firstObservedFailedPodIsNotStale() {
    // 지금 Pod(pod-a, 시작 T0)보다 뒤에 뜬 실패 Pod(pod-b) — 관찰이 받아져 정체를 갈아끼운다.
    seedIdentity("pod-a", null, T0);
    Row newer = observeWithUid(T2, "pod-b", "FAILED").get(agent).row();
    assertThat(newer.observedPodUid()).isEqualTo("pod-b");
    assertThat(newer.previousPodUid()).isEqualTo("pod-a");

    // 시작이 이르지 않은(같은) FAILED 관찰은 끝나는 중인 옛 Pod — previous 가 비어 있어도 지난 정체다.
    seedIdentity("pod-b", null, T2);
    assertThat(observeWithUid(T2, "pod-a", "FAILED")).isEmpty();

    // 바로 앞 정체의 FAILED 관찰도 같다.
    seedIdentity("pod-b", "pod-a", T2);
    assertThat(observeWithUid(T2, "pod-a", "FAILED")).isEmpty();
  }

  /**
   * 꺼졌다 켠 AI 의 실패한 새 Pod 관찰이 버려지지 않는다(WP-1968 4차 반려) — Pod 가 사라진 STOPPED 관찰이 정체는 남긴 채 시작 시각만 비우면, 그
   * 뒤 첫 관찰이 이미 FAILED 인 새 Pod 를 「시작을 모르는 옛 Pod」로 단정해 매번 버린다(「오류」가 화면에 안 뜬다 — 3차 반려 ① 의 그 경우). 지금
   * Pod 시작이 비어 있으면 뒤인지 아닌지 가를 수 없어 받아들인다.
   */
  @Test
  void updateObserved_failedPodAfterClearedStartIsNotStale() {
    // 지금 Pod(pod-a)의 정체가 이미 밝혀져 있다.
    seedIdentity("pod-a", null, T0);

    // Pod 가 사라진 STOPPED 관찰 — 정체는 남고 시작 시각만 비어 있다.
    assertThat(observeWithUid(null, null, "STOPPED")).containsKey(agent);
    Row stopped = settings.find(agent).orElseThrow();
    assertThat(stopped.startedAt()).isNull();
    assertThat(stopped.observedPodUid()).isEqualTo("pod-a");

    // 다시 켠 뒤 첫 관찰이 이미 FAILED 인 새 Pod — 지난 정체로 보지 않고 받아 정체를 갈아끼운다.
    Row failed = observeWithUid(T2, "pod-c", "FAILED").get(agent).row();
    assertThat(failed.observedPodUid()).isEqualTo("pod-c");
    assertThat(failed.phase()).isEqualTo("FAILED");

    // 같은 시각 비어 있는 상태에서도 바로 앞 정체(previous)의 FAILED 관찰은 그대로 지난 정체다 — 기준 없음을
    // 모든 정체 불일치 FAILED 로 받아들이지 않는다(정체가 살아 있는 Pod 로 뒤집히는 창은 여전히 막는다).
    seedIdentity("pod-c", "pod-a", null);
    assertThat(observeWithUid(T2, "pod-a", "FAILED")).isEmpty();
  }

  /**
   * 정체가 다르고 시작 시각이 없는 FAILED 관찰은 previous 정체일 때만 지난 것이다(WP-1968 6차 반려 ③) — 관찰에 시각이 없어 이른지 아닌지 견볼 수
   * 없는데 지난 것으로 버리면, 진짜 실패한 지금 Pod 의 「오류」가 화면에 계속 안 뜬다.
   */
  @Test
  void updateObserved_failedObservationWithoutStartIsStaleOnlyForPrevious() {
    seedIdentity("pod-b", null, T2);

    // 정체가 다르고 시작 시각이 없는 FAILED — 지난 정체로 단정하지 않고 받아 정체를 갈아끼운다(실패가 화면에 보인다).
    Row accepted = observeWithUid(null, "pod-a", "FAILED").get(agent).row();
    assertThat(accepted.observedPodUid()).isEqualTo("pod-a");
    assertThat(accepted.phase()).isEqualTo("FAILED");

    // 같은 조건이어도 previous 정체면 끝나는 중인 옛 Pod 라 지난 것이다.
    seedIdentity("pod-c", "pod-a", T2);
    assertThat(observeWithUid(null, "pod-a", "FAILED")).isEmpty();

    // 시작 시각이 있는 FAILED 는 이전 판정 그대로다 — 지금 알던 시작보다 이르면(새로 뜬 Pod 가 아니면) 지난 것이다.
    seedIdentity("pod-c", null, T2);
    assertThat(observeWithUid(T2, "pod-a", "FAILED")).isEmpty();
  }

  /**
   * 관찰의 옛 Pod 판정에 시계 차이 여유(30초 — 메모리 판정 {@code isOlderPod} 와 같은 값)를 쓴다(WP-1968 3차 반려 ②) — 여유 없이
   * 비교하면 죽은 빠른 시계 Pod 가 올려 둔 기준보다 조금 이른 새 Pod 관찰이 지난 정체로 걸려, 관찰이 정체를 밝히는 회복 경로가 막힌다. 정확히 30초 이른 시작은
   * 여유 경계 안이라 그대로 받는다(메모리 판정과 경계가 같다).
   */
  @Test
  void updateObserved_olderPodUsesClockSkewGrace() {
    // 정확히 30초 이른 시작은 여유 경계 안 — 정체를 갈아끼운다.
    seedIdentity("pod-b", null, T2);
    Row atBoundary = observeWithUid(T2.minusSeconds(30), "pod-a", "RUNNING").get(agent).row();
    assertThat(atBoundary.observedPodUid()).isEqualTo("pod-a");

    // 30초 안의 시작 차이(25초)도 같은 이유로 지난 정체가 아니다.
    seedIdentity("pod-b", null, T2);
    Row withinGrace = observeWithUid(T2.minusSeconds(25), "pod-a", "RUNNING").get(agent).row();
    assertThat(withinGrace.observedPodUid()).isEqualTo("pod-a");

    // 여유(30초)를 넘게 이른 시작은 그대로 지난 정체다.
    seedIdentity("pod-b", null, T2);
    assertThat(observeWithUid(T2.minusSeconds(31), "pod-a", "RUNNING")).isEmpty();
  }

  /**
   * 빈 정체(공백) 관찰은 null 로 — 지금 정체를 지우거나 지난 상태를 비우지 않는다(WP-1968 2차 반려 ⑤) — 메모리 판정은 공백을 「모른다」로 보는데 SQL
   * 이 실제 값으로 보면 `'' ≠ 현재 정체` 가 돼 새 Pod 로 오판해 agent_* 가 한 번에 비워지고 정체 칸도 공백으로 갈아끼워진다.
   */
  @Test
  void updateObserved_blankPodUidKeepsIdentityAndAgentState() {
    seedIdentity("pod-a", null, T0);
    settings.writeAgentState(agent, WORKING, List.of("WP-1"), T1, OffsetDateTime.now(), null, null);

    assertThat(observeWithUid(T0, "  ")).containsKey(agent);

    Row row = settings.find(agent).orElseThrow();
    assertThat(row.observedPodUid()).isEqualTo("pod-a");
    assertThat(row.previousPodUid()).isNull();
    assertThat(row.agentState()).isEqualTo("WORKING");
    assertThat(row.agentIssueKeys()).containsExactly("WP-1");
  }

  /** 칸 삭제에 넘기는 지금 Pod 판정도 빈 정체를 null 로 맞춘다 — 메모리 판정과 SQL 이 같은 값으로 옛 Pod 칸을 가르게(WP-1968 2차 반려 ⑤). */
  @Test
  void podStarts_blankIdentityIsTreatedAsNull() {
    assertThat(new PodStarts(T0, T0, "").podUid()).isNull();
    assertThat(new PodStarts(T0, T0, "   ").podUid()).isNull();
    assertThat(new PodStarts(T0, T0, "pod-a").podUid()).isEqualTo("pod-a");
  }
}
