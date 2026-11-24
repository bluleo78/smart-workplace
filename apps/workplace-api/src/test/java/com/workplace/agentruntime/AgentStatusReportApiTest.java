package com.workplace.agentruntime;

import static com.workplace.jooq.Tables.AGENT_API_KEY;
import static com.workplace.jooq.Tables.AGENT_RUNTIME_SETTING;
import static com.workplace.jooq.Tables.AGENT_RUNTIME_SLOT_STATE;
import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.authentication;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.workplace.agentruntime.dto.AgentState;
import com.workplace.agentruntime.dto.CreateAgentLocationRequest;
import com.workplace.agentruntime.dto.PutAgentRuntimeSettingRequest;
import com.workplace.agentruntime.dto.RunnerObservedAgent;
import com.workplace.agentruntime.outbound.AgentRuntimeChangeNotifier;
import com.workplace.agentruntime.outbound.AgentRuntimeDesiredChanged;
import com.workplace.agentruntime.repository.AgentRuntimeSettingRepository;
import com.workplace.agentruntime.repository.AgentRuntimeSlotRepository;
import com.workplace.agentruntime.service.AgentLocationService;
import com.workplace.agentruntime.service.AgentRuntimeSettingService;
import com.workplace.auth.repository.AgentApiKeyRepository;
import com.workplace.auth.service.AgentApiKeyService;
import com.workplace.global.realtime.ResourceChangedEvent;
import com.workplace.global.security.AgentTenantResolver;
import com.workplace.global.tenant.TenantContext;
import com.workplace.global.util.CapabilityTokens;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.TestFixtures;
import com.workplace.support.WebSessionAuth;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.Map;
import org.jooq.DSLContext;
import org.jooq.Record;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.test.context.event.ApplicationEvents;
import org.springframework.test.context.event.RecordApplicationEvents;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import org.springframework.transaction.annotation.Transactional;

/**
 * WP-1250 AI 상태 보고 API 통합 테스트 — Works 가 띄운 AI 가 자기 키로 상태를 보고하면 agent_* 칸에 남고, 원하는
 * 상태(RUN·DRAIN·RESTART)를 돌려받는다. 쉬는 중인데 교체가 걸려 있으면 runner 에 변경 이벤트가 나간다. 실행 설정이 없는 외부 AI 는 저장 없이 RUN
 * 이다.
 */
@Transactional
@RecordApplicationEvents
class AgentStatusReportApiTest extends IntegrationTestBase {

  private static final String URL = "/api/v1/agent-runtime/me/status";

  @Autowired MockMvc mvc;
  @Autowired DSLContext dsl;
  @Autowired tools.jackson.databind.ObjectMapper om;
  @Autowired AgentLocationService locationService;
  @Autowired AgentRuntimeSettingService settingService;
  @Autowired AgentApiKeyService keyService;
  @Autowired AgentApiKeyRepository keyRepo;
  @Autowired ApplicationEvents appEvents;
  @Autowired AgentRuntimeSlotRepository slots;
  @Autowired AgentRuntimeSettingRepository settings;

  private long admin;
  private AgentRuntimeTestFixtures fx;
  private long location;
  private long agent;
  private String key;

  @BeforeEach
  void seed() {
    TenantContext.set(1L);
    admin = TestFixtures.activeMemberOfCurrentTenant(dsl, TestFixtures.createHuman(dsl));
    TestFixtures.grantRole(dsl, admin, "ADMIN");
    fx = new AgentRuntimeTestFixtures(dsl, om, settingService, admin);
    location =
        locationService
            .create(admin, new CreateAgentLocationRequest("L1", null, 5))
            .location()
            .id();
    agent = TestFixtures.activeMemberOfCurrentTenant(dsl, TestFixtures.createAgentNoToken(dsl));
    settingService.put(
        admin, agent, new PutAgentRuntimeSettingRequest("claude-code", null, Map.of(), null));
    settingService.start(admin, agent);
    key = keyService.issueManaged(agent, 1L, null, null, "L1").plaintext();
    appEvents.clear();
  }

  /** AI 키로 상태를 보고한다 — 호출 전후로 GUC 를 테넌트 1 로 맞춘다. */
  private ResultActions report(String akKey, String body) throws Exception {
    return report(akKey, body, null);
  }

  private ResultActions report(String akKey, String body, Long tenantHeader) throws Exception {
    useTenant(1L);
    MockHttpServletRequestBuilder b =
        put(URL)
            .header("Authorization", "Bearer " + akKey)
            .contentType(MediaType.APPLICATION_JSON)
            .content(body);
    if (tenantHeader != null) b = b.header(AgentTenantResolver.TENANT_HEADER, tenantHeader);
    ResultActions r = mvc.perform(b);
    useTenant(1L);
    return r;
  }

  private Record settingOf(long agentUserId) {
    return dsl.selectFrom(AGENT_RUNTIME_SETTING)
        .where(AGENT_RUNTIME_SETTING.AGENT_USER_ID.eq(agentUserId))
        .fetchOne();
  }

  /** 관찰 generation·적용 방식·원하는 상태를 직접 맞춘다. */
  private void setRow(long agentUserId, Long observedGeneration, String applyMode, String desired) {
    dsl.update(AGENT_RUNTIME_SETTING)
        .set(AGENT_RUNTIME_SETTING.OBSERVED_GENERATION, observedGeneration)
        .set(AGENT_RUNTIME_SETTING.APPLY_MODE, applyMode)
        .set(AGENT_RUNTIME_SETTING.DESIRED, desired)
        .where(AGENT_RUNTIME_SETTING.AGENT_USER_ID.eq(agentUserId))
        .execute();
  }

  private long changedEvents() {
    return appEvents.stream(AgentRuntimeDesiredChanged.class).count();
  }

  /**
   * 관리자 화면 실시간 알림(resource agent-runtime) 수 — 화면에 보이는 것이 바뀔 때만 나가야 한다(WP-1254·1913). 테스트는 트랜잭션을
   * 되돌리므로 커밋 직전 디스패처는 돌지 않고 발행된 이벤트만 기록된다.
   */
  private long runtimeEvents() {
    return appEvents.stream(ResourceChangedEvent.class)
        .filter(e -> AgentRuntimeChangeNotifier.RESOURCE_AGENT_RUNTIME.equals(e.resource()))
        .count();
  }

  /** 실행 설정이 없는 AI(외부 실행)는 저장 없이 RUN — 외부 AI 동작이 바뀌지 않는다. */
  @Test
  void status_forExternalAgentWithoutSetting_returnsRunAndStoresNothing() throws Exception {
    long external =
        TestFixtures.activeMemberOfCurrentTenant(dsl, TestFixtures.createAgentNoToken(dsl));
    String extKey = keyService.issueManaged(external, 1L, null, null, "L1").plaintext();

    report(extKey, "{\"state\":\"IDLE\",\"generation\":1}")
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.desired").value("RUN"));

    assertThat(settingOf(external)).isNull();
    assertThat(changedEvents()).isZero();
  }

  /** 보고한 상태·이슈 키가 관리자 화면의 관찰 상태로 보인다. 쉬는 중 보고는 이슈 키를 지운다. */
  @Test
  void status_storesAgentColumns() throws Exception {
    long g = fx.generationOf(agent);
    report(
            key,
            "{\"state\":\"WORKING\",\"issueKey\":\"WD-1\",\"nextCheckAt\":\"2026-11-01T12:00:00+09:00\",\"generation\":"
                + g
                + "}")
        .andExpect(status().isOk());

    TenantContext.set(1L);
    mvc.perform(
            get("/api/v1/admin/agents/" + agent + "/runtime-setting")
                .with(
                    authentication(
                        WebSessionAuth.of(
                            admin, List.of(new SimpleGrantedAuthority("user:write"))))))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.observed.agentState").value("WORKING"))
        .andExpect(jsonPath("$.observed.agentIssueKey").value("WD-1"))
        .andExpect(jsonPath("$.observed.agentIssueKeys[0]").value("WD-1"))
        // 다음 확인 시각은 쉬는 칸에서만 나온다(WP-1409 합치기 규칙) — 일하는 보고에 실린 값은 싣지 않는다.
        .andExpect(jsonPath("$.observed.agentNextCheckAt").doesNotExist());
    assertThat(fx.generationOf(agent)).isEqualTo(g);

    report(key, "{\"state\":\"IDLE\"}").andExpect(status().isOk());
    assertThat(settingOf(agent).get(AGENT_RUNTIME_SETTING.AGENT_STATE)).isEqualTo("IDLE");
    assertThat(settingOf(agent).get(AGENT_RUNTIME_SETTING.AGENT_ISSUE_KEY)).isNull();
  }

  /**
   * 합친 상태가 IDLE → IDLE 로 그대로(화면에 보이는 칸 불변)여도 보고 시각이 지금 Pod 시작 뒤로 올라 적용 판정이 쉴 때 → 지금으로 바뀌면 화면에 한 번
   * 알리고 runner 도 한 번 깨운다(WP-2000 코드 리뷰). 이미 쉬는 중이던 AI 라 becameIdle 은 아니지만 깨우기는 runner 가 읽는
   * 판정(decide)의 전이를 따른다 — 옛 기대는 깨우기 0 이었다.
   */
  @Test
  void report_whenOnlyDecisionChanges_publishesOnce() throws Exception {
    long g = fx.generationOf(agent);
    OffsetDateTime podStart = OffsetDateTime.now().minusMinutes(10);
    dsl.update(AGENT_RUNTIME_SETTING)
        .set(AGENT_RUNTIME_SETTING.OBSERVED_GENERATION, g - 1)
        .set(AGENT_RUNTIME_SETTING.APPLY_MODE, "IDLE")
        .set(AGENT_RUNTIME_SETTING.PHASE, "RUNNING")
        .set(AGENT_RUNTIME_SETTING.STARTED_AT, podStart)
        .set(AGENT_RUNTIME_SETTING.AGENT_STATE, "IDLE")
        .set(AGENT_RUNTIME_SETTING.AGENT_REPORTED_AT, podStart.minusMinutes(5))
        .where(AGENT_RUNTIME_SETTING.AGENT_USER_ID.eq(agent))
        .execute();
    appEvents.clear();

    report(key, "{\"state\":\"IDLE\",\"generation\":" + (g - 1) + "}").andExpect(status().isOk());

    assertThat(runtimeEvents()).isEqualTo(1);
    assertThat(changedEvents()).isEqualTo(1);
  }

  /** 막 쉬는 중이 됐고(becameIdle) 같은 보고로 decide 도 NOW 가 돼도 깨우기는 한 번이다(WP-2000 코드 리뷰). */
  @Test
  void report_whenBecameIdleAndDecisionNow_wakesOnce() throws Exception {
    long g = fx.generationOf(agent);
    OffsetDateTime podStart = OffsetDateTime.now().minusMinutes(10);
    dsl.update(AGENT_RUNTIME_SETTING)
        .set(AGENT_RUNTIME_SETTING.OBSERVED_GENERATION, g - 1)
        .set(AGENT_RUNTIME_SETTING.APPLY_MODE, "IDLE")
        .set(AGENT_RUNTIME_SETTING.PHASE, "RUNNING")
        .set(AGENT_RUNTIME_SETTING.STARTED_AT, podStart)
        .where(AGENT_RUNTIME_SETTING.AGENT_USER_ID.eq(agent))
        .execute();
    report(key, "{\"state\":\"WORKING\",\"issueKey\":\"WD-1\",\"generation\":" + (g - 1) + "}")
        .andExpect(status().isOk());
    appEvents.clear();

    report(key, "{\"state\":\"IDLE\",\"generation\":" + (g - 1) + "}").andExpect(status().isOk());

    assertThat(changedEvents()).isEqualTo(1);
  }

  /** 이미 decide 가 NOW 인 AI 의 거듭된 보고는 깨우지 않는다(WP-2000 코드 리뷰). */
  @Test
  void report_whenDecisionAlreadyNow_doesNotWake() throws Exception {
    long g = fx.generationOf(agent);
    dsl.update(AGENT_RUNTIME_SETTING)
        .set(AGENT_RUNTIME_SETTING.OBSERVED_GENERATION, g - 1)
        .set(AGENT_RUNTIME_SETTING.APPLY_MODE, "IDLE")
        .set(AGENT_RUNTIME_SETTING.PHASE, "RUNNING")
        .set(AGENT_RUNTIME_SETTING.AGENT_STATE, "IDLE")
        .where(AGENT_RUNTIME_SETTING.AGENT_USER_ID.eq(agent))
        .execute();

    report(key, "{\"state\":\"IDLE\",\"generation\":" + (g - 1) + "}").andExpect(status().isOk());

    assertThat(changedEvents()).isZero();
  }

  /** 꺼진 AI 는 DRAIN — 지워지는 Pod 가 새 이슈를 집지 않게. */
  @Test
  void status_whenDesiredStop_returnsDrain() throws Exception {
    long g = fx.generationOf(agent);
    setRow(agent, g, "IDLE", "STOP");

    report(key, "{\"state\":\"IDLE\",\"generation\":" + g + "}")
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.desired").value("DRAIN"));
  }

  /** 떠 있는 generation 이 뒤처졌고 쉴 때 적용이면 DRAIN — 쉬면 runner 가 다시 띄운다. */
  @Test
  void status_whenGenerationBehindAndApplyModeIdle_returnsDrain() throws Exception {
    long g = fx.generationOf(agent);
    setRow(agent, g - 1, "IDLE", "RUN");

    report(key, "{\"state\":\"WORKING\",\"issueKey\":\"WD-2\",\"generation\":" + (g - 1) + "}")
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.desired").value("DRAIN"));
  }

  /** 떠 있는 generation 이 뒤처졌고 바로 적용이면 RESTART. */
  @Test
  void status_whenGenerationBehindAndApplyModeNow_returnsRestart() throws Exception {
    long g = fx.generationOf(agent);
    setRow(agent, g - 1, "NOW", "RUN");

    report(key, "{\"state\":\"WORKING\",\"generation\":" + (g - 1) + "}")
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.desired").value("RESTART"));
  }

  /** 새 작업 받기 스위치를 DB 에서 직접 맞춘다(WP-1514). */
  private void setAcceptNewWork(long agentUserId, boolean value) {
    dsl.update(AGENT_RUNTIME_SETTING)
        .set(AGENT_RUNTIME_SETTING.ACCEPT_NEW_WORK, value)
        .where(AGENT_RUNTIME_SETTING.AGENT_USER_ID.eq(agentUserId))
        .execute();
  }

  /** 스위치가 꺼지고 generation 이 최신이면 HOLD — 하던 일은 마치되 새 이슈는 집지 않는다. */
  @Test
  void status_acceptNewWorkFalse_returnsHold() throws Exception {
    long g = fx.generationOf(agent);
    setRow(agent, g, "IDLE", "RUN");
    setAcceptNewWork(agent, false);

    report(key, "{\"state\":\"IDLE\",\"generation\":" + g + "}")
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.desired").value("HOLD"));
  }

  /** 보고에 generation 이 없어도(옛 플러그인) 스위치가 꺼져 있으면 HOLD. */
  @Test
  void status_acceptNewWorkFalse_generationNull_returnsHold() throws Exception {
    long g = fx.generationOf(agent);
    setRow(agent, g, "IDLE", "RUN");
    setAcceptNewWork(agent, false);

    report(key, "{\"state\":\"IDLE\"}")
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.desired").value("HOLD"));
  }

  /** 꺼진 AI(STOP)는 스위치가 꺼져 있어도 DRAIN — 종료가 이긴다. */
  @Test
  void status_stopAndSwitchOff_returnsDrain() throws Exception {
    long g = fx.generationOf(agent);
    setRow(agent, g, "IDLE", "STOP");
    setAcceptNewWork(agent, false);

    report(key, "{\"state\":\"IDLE\",\"generation\":" + g + "}")
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.desired").value("DRAIN"));
  }

  /** 뒤처진 generation 은 스위치가 꺼져 있어도 RESTART/DRAIN 이 먼저 — 새 설정으로 다시 떠야 한다. */
  @Test
  void status_laggingGenerationNow_switchOff_returnsRestart() throws Exception {
    long g = fx.generationOf(agent);
    setRow(agent, g - 1, "NOW", "RUN");
    setAcceptNewWork(agent, false);

    report(key, "{\"state\":\"WORKING\",\"generation\":" + (g - 1) + "}")
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.desired").value("RESTART"));
  }

  @Test
  void status_laggingGenerationIdle_switchOff_returnsDrain() throws Exception {
    long g = fx.generationOf(agent);
    setRow(agent, g - 1, "IDLE", "RUN");
    setAcceptNewWork(agent, false);

    report(key, "{\"state\":\"WORKING\",\"issueKey\":\"WD-2\",\"generation\":" + (g - 1) + "}")
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.desired").value("DRAIN"));
  }

  /** 스위치가 켜져 있으면 기존 동작 그대로 RUN. */
  @Test
  void status_switchOn_returnsRun() throws Exception {
    long g = fx.generationOf(agent);
    setRow(agent, g, "IDLE", "RUN");
    setAcceptNewWork(agent, true);

    report(key, "{\"state\":\"IDLE\",\"generation\":" + g + "}")
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.desired").value("RUN"));
  }

  /** 떠 있는 generation 이 최신이면 RUN, 교체 대기가 없으니 쉬는 중 보고에도 이벤트가 없다. */
  @Test
  void status_whenUpToDate_returnsRun() throws Exception {
    long g = fx.generationOf(agent);
    setRow(agent, g, "IDLE", "RUN");

    report(key, "{\"state\":\"IDLE\",\"generation\":" + g + "}")
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.desired").value("RUN"));
    assertThat(changedEvents()).isZero();
  }

  /** 쉬는 중을 보고했는데 교체가 걸려 있으면(generation ≠ observedGeneration) 실제 위치에 변경 이벤트가 나간다. */
  @Test
  void status_idleWhilePendingApply_publishesDesiredChanged() throws Exception {
    long g = fx.generationOf(agent);
    setRow(agent, g - 1, "IDLE", "RUN");

    report(key, "{\"state\":\"IDLE\",\"generation\":" + (g - 1) + "}").andExpect(status().isOk());

    assertThat(appEvents.stream(AgentRuntimeDesiredChanged.class).toList())
        .containsExactly(new AgentRuntimeDesiredChanged(1L, location));
  }

  /** 쉬는 중을 거듭 보고해도 이벤트는 쉬는 중으로 바뀐 첫 보고에서만 나간다 — 다음 확인마다 runner 를 깨우지 않게(WP-1250). */
  @Test
  void status_repeatedIdle_publishesOnlyOnTransition() throws Exception {
    long g = fx.generationOf(agent);
    setRow(agent, g - 1, "IDLE", "RUN");

    report(key, "{\"state\":\"IDLE\",\"generation\":" + (g - 1) + "}").andExpect(status().isOk());
    report(key, "{\"state\":\"IDLE\",\"generation\":" + (g - 1) + "}").andExpect(status().isOk());

    assertThat(changedEvents()).isEqualTo(1);
  }

  /**
   * 키 교체가 확인되기 전 지금 Pod 의 옛 키가 24시간 안에 만료되면 일하는 중이어도 RESTART 다 — runner 의 applyNow 와 같은
   * 판정이다(WP-1253).
   */
  @Test
  void status_whenPodKeyExpiresSoon_returnsRestart() throws Exception {
    long g = fx.generationOf(agent);
    setRow(agent, g - 1, "IDLE", "RUN");
    dsl.update(AGENT_API_KEY)
        .set(AGENT_API_KEY.EXPIRES_AT, OffsetDateTime.now().plusHours(1))
        .where(AGENT_API_KEY.USER_ID.eq(agent))
        .execute();
    keyRepo.insertManaged(
        agent,
        1L,
        "ak_current",
        "hash-current",
        "Works 자동 발급",
        OffsetDateTime.now().plusDays(30),
        g);

    report(key, "{\"state\":\"WORKING\",\"issueKey\":\"WD-4\",\"generation\":" + (g - 1) + "}")
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.desired").value("RESTART"));
  }

  /** 일하는 중이면 교체가 걸려 있어도 이벤트를 내지 않는다 — 하던 일을 마치게. */
  @Test
  void status_workingWhilePendingApply_publishesNothing() throws Exception {
    long g = fx.generationOf(agent);
    setRow(agent, g - 1, "IDLE", "RUN");

    report(key, "{\"state\":\"WORKING\",\"issueKey\":\"WD-3\",\"generation\":" + (g - 1) + "}")
        .andExpect(status().isOk());

    assertThat(changedEvents()).isZero();
  }

  /** 사람은 상태를 보고할 수 없다 — 403. */
  @Test
  void status_fromHuman_returns403() throws Exception {
    TenantContext.set(1L);
    mvc.perform(
            put(URL)
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"state\":\"IDLE\"}")
                .with(authentication(WebSessionAuth.of(admin, List.of()))))
        .andExpect(status().isForbidden())
        .andExpect(jsonPath("$.errors.code").value("AGENT_ONLY"));
  }

  /** 상태가 없으면 400. */
  @Test
  void status_withoutState_returns400() throws Exception {
    report(key, "{\"issueKey\":\"WD-1\"}").andExpect(status().isBadRequest());
  }

  // ---- WP-1409 칸별 보고 ----

  /** 이 AI 의 칸 키들(칸 키 순). */
  private List<String> slotKeysOf(long agentUserId) {
    return dsl.select(AGENT_RUNTIME_SLOT_STATE.SLOT_KEY)
        .from(AGENT_RUNTIME_SLOT_STATE)
        .where(AGENT_RUNTIME_SLOT_STATE.AGENT_USER_ID.eq(agentUserId))
        .orderBy(AGENT_RUNTIME_SLOT_STATE.SLOT_KEY)
        .fetch(AGENT_RUNTIME_SLOT_STATE.SLOT_KEY);
  }

  /** 칸 보고 본문 — null 인 값은 싣지 않는다. */
  private String slotReport(String state, String slot, String issueKey, Long generation)
      throws Exception {
    return slotReport(state, slot, issueKey, generation, null);
  }

  /** 칸 보고 본문(다음 확인 시각 포함) — null 인 값은 싣지 않는다. */
  private String slotReport(
      String state, String slot, String issueKey, Long generation, String nextCheckAt)
      throws Exception {
    return slotReportBody(state, slot, issueKey, generation, nextCheckAt, null, null);
  }

  /**
   * 칸 보고 본문(보고한 Pod 시작 시각 포함) — 서버가 끝나는 중인 옛 Pod 의 늦은 보고를 지금 Pod 의 보고와 갈라 보는 데 쓴다(WP-1913 리뷰 반려 ①).
   */
  private String slotReportWithPod(
      String state, String slot, String issueKey, Long generation, OffsetDateTime podStartedAt)
      throws Exception {
    return slotReportBody(state, slot, issueKey, generation, null, podStartedAt, null);
  }

  /** 칸 보고 본문(Pod 정체 포함) — 보고하는 Pod 의 {@code metadata.uid} 를 싣고 관찰 정체와 견겨 보고를 받거나 버린다(WP-1968). */
  private String slotReportWithIdentity(
      String state,
      String slot,
      String issueKey,
      Long generation,
      OffsetDateTime podStartedAt,
      String podUid)
      throws Exception {
    return slotReportBody(state, slot, issueKey, generation, null, podStartedAt, podUid);
  }

  /** 칸 보고 본문 — null 인 값은 싣지 않는다. 선택 값(다음 확인 시각·Pod 시작 시각·Pod 정체)은 한 군데서만 쌓아 본문이 어긋나지 않게 한다. */
  private String slotReportBody(
      String state,
      String slot,
      String issueKey,
      Long generation,
      String nextCheckAt,
      OffsetDateTime podStartedAt,
      String podUid)
      throws Exception {
    Map<String, Object> body = new java.util.LinkedHashMap<>();
    body.put("state", state);
    if (slot != null) body.put("slot", slot);
    if (issueKey != null) body.put("issueKey", issueKey);
    if (generation != null) body.put("generation", generation);
    if (nextCheckAt != null) body.put("nextCheckAt", nextCheckAt);
    if (podStartedAt != null) body.put("podStartedAt", podStartedAt);
    if (podUid != null) body.put("podUid", podUid);
    return om.writeValueAsString(body);
  }

  /**
   * 이슈가 요구한 핵심 — 칸 A 가 일하는 중에 칸 B 가 쉬는 중을 보고해도 AI 는 작업 중이고, 미뤄 둔 교체가 있어도 B 는 RESTART 가 아니라 DRAIN(새
   * 이슈를 집지 않음)이며 변경 이벤트도 나가지 않는다.
   */
  @Test
  void status_slotAWorkingSlotBIdle_aggregateIsWorkingAndNotApplied() throws Exception {
    long g = fx.generationOf(agent);
    setRow(agent, g - 1, "IDLE", "RUN");

    report(key, slotReport("WORKING", "WP", "WP-1", g - 1))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.desired").value("DRAIN"));
    report(key, slotReport("IDLE", "HR", null, g - 1, "2026-11-01T12:00:00+09:00"))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.desired").value("DRAIN"));

    Record s = settingOf(agent);
    assertThat(s.get(AGENT_RUNTIME_SETTING.AGENT_STATE)).isEqualTo("WORKING");
    assertThat(s.get(AGENT_RUNTIME_SETTING.AGENT_ISSUE_KEY)).isEqualTo("WP-1");
    assertThat(s.get(AGENT_RUNTIME_SETTING.AGENT_ISSUE_KEYS)).containsExactly("WP-1");
    assertThat(changedEvents()).isZero();
  }

  /** 모든 칸이 쉴 때만 쉬는 중 — 마지막 일하던 칸이 쉬는 순간 RESTART·이벤트 1회, 그 뒤 거듭된 쉬는 중 보고는 이벤트를 다시 내지 않는다. */
  @Test
  void status_twoSlots_restartOnlyWhenAllIdle() throws Exception {
    long g = fx.generationOf(agent);
    setRow(agent, g - 1, "IDLE", "RUN");
    report(key, slotReport("WORKING", "WP", "WP-1", g - 1)).andExpect(status().isOk());
    report(key, slotReport("IDLE", "HR", null, g - 1)).andExpect(status().isOk());

    report(key, slotReport("IDLE", "WP", null, g - 1))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.desired").value("RESTART"));
    Record s = settingOf(agent);
    assertThat(s.get(AGENT_RUNTIME_SETTING.AGENT_STATE)).isEqualTo("IDLE");
    assertThat(s.get(AGENT_RUNTIME_SETTING.AGENT_ISSUE_KEYS)).containsExactly();
    assertThat(appEvents.stream(AgentRuntimeDesiredChanged.class).toList())
        .containsExactly(new AgentRuntimeDesiredChanged(1L, location));

    report(key, slotReport("IDLE", "HR", null, g - 1)).andExpect(status().isOk());
    assertThat(changedEvents()).isEqualTo(1);
  }

  /** 다음 확인 시각은 쉬는 칸 중 가장 이른 것. */
  @Test
  void status_nextCheckIsEarliestIdleSlot() throws Exception {
    report(key, slotReport("IDLE", "WP", null, null, "2026-11-01T12:00:00+09:00"))
        .andExpect(status().isOk());
    report(key, slotReport("IDLE", "HR", null, null, "2026-11-01T11:00:00+09:00"))
        .andExpect(status().isOk());

    assertThat(settingOf(agent).get(AGENT_RUNTIME_SETTING.AGENT_NEXT_CHECK_AT).toInstant())
        .isEqualTo(OffsetDateTime.parse("2026-11-01T11:00:00+09:00").toInstant());
  }

  /** 칸을 밝히지 않은 보고(옛 플러그인)는 '' 칸 하나로 — 지금처럼 마지막 보고가 AI 상태다. */
  @Test
  void status_withoutSlot_behavesAsSingleSlot() throws Exception {
    report(key, slotReport("WORKING", null, "WD-1", null)).andExpect(status().isOk());
    report(key, slotReport("IDLE", null, null, null)).andExpect(status().isOk());

    Record s = settingOf(agent);
    assertThat(s.get(AGENT_RUNTIME_SETTING.AGENT_STATE)).isEqualTo("IDLE");
    assertThat(s.get(AGENT_RUNTIME_SETTING.AGENT_ISSUE_KEY)).isNull();
    assertThat(slotKeysOf(agent)).containsExactly("");
  }

  /**
   * Pod 가 다시 뜬 뒤에는 옛 Pod 의 칸('' 의 WORKING)이 합친 상태를 붙잡지 않고 지워진다. 시작 시각을 지금보다 5분 뒤로 두어 API 서버 시계가 30초
   * 넘게 늦은 경우도 덮는다 — 그래도 방금 보고한 칸('WP')은 지우지 않고 합친다.
   */
  @Test
  void status_legacySlotFromOldPod_isIgnoredAfterPodRestart() throws Exception {
    report(key, slotReport("WORKING", null, "WP-0", null)).andExpect(status().isOk());
    dsl.update(AGENT_RUNTIME_SETTING)
        // 시계 차이 여유(30초)보다 충분히 뒤로 — 앞 보고도 이번 보고도 「시작 시각 − 30초」보다 앞선다.
        .set(AGENT_RUNTIME_SETTING.STARTED_AT, OffsetDateTime.now().plusMinutes(5))
        .where(AGENT_RUNTIME_SETTING.AGENT_USER_ID.eq(agent))
        .execute();

    report(key, slotReport("IDLE", "WP", null, null)).andExpect(status().isOk());

    assertThat(settingOf(agent).get(AGENT_RUNTIME_SETTING.AGENT_STATE)).isEqualTo("IDLE");
    assertThat(slotKeysOf(agent)).containsExactly("WP");
  }

  /**
   * 보고가 6시간 넘게 끊긴 칸(죽은 칸)은 합치기에서 빠진다(WP-1409) — 7시간 전 WORKING 칸이 남아 있어도 다른 칸이 쉬면 AI 는 쉬는 중이고, 미뤄 둔
   * 교체가 적용된다(RESTART·이벤트). 칸 행은 지우지 않는다.
   */
  @Test
  void status_staleWorkingSlot_doesNotBlockIdleAggregate() throws Exception {
    long g = fx.generationOf(agent);
    setRow(agent, g - 1, "IDLE", "RUN");
    slots.upsert(
        agent,
        "HR",
        AgentState.WORKING,
        "HR-2",
        null,
        OffsetDateTime.now().minusHours(7),
        null,
        null);

    report(key, slotReport("IDLE", "WP", null, g - 1))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.desired").value("RESTART"));

    Record s = settingOf(agent);
    assertThat(s.get(AGENT_RUNTIME_SETTING.AGENT_STATE)).isEqualTo("IDLE");
    assertThat(s.get(AGENT_RUNTIME_SETTING.AGENT_ISSUE_KEYS)).containsExactly();
    assertThat(changedEvents()).isEqualTo(1);
    assertThat(slotKeysOf(agent)).containsExactly("HR", "WP");
  }

  /** 칸 키는 대소문자를 가리지 않는다 — 'wp' 와 'WP' 는 같은 칸. */
  @Test
  void status_slotKeyIsCaseInsensitive() throws Exception {
    report(key, slotReport("WORKING", "wp", "WP-1", null)).andExpect(status().isOk());
    report(key, slotReport("IDLE", "WP", null, null)).andExpect(status().isOk());

    assertThat(slotKeysOf(agent)).containsExactly("WP");
    assertThat(settingOf(agent).get(AGENT_RUNTIME_SETTING.AGENT_STATE)).isEqualTo("IDLE");
  }

  /** 형식이 아닌 칸 키(공백·33자)는 400 이고 아무것도 저장하지 않는다. */
  @Test
  void status_withInvalidSlot_returns400() throws Exception {
    report(key, slotReport("IDLE", "W P", null, null)).andExpect(status().isBadRequest());
    report(key, slotReport("IDLE", "A".repeat(33), null, null)).andExpect(status().isBadRequest());

    assertThat(slotKeysOf(agent)).isEmpty();
  }

  /**
   * 남아 있던 진입점 차단 메시지는 정상 칸 보고(칸이 도는 중인 보고)가 오는 순간 비워진다 — 칸이 띄워졌다는 증거이므로(WP-1913 백스톱) 차단 보고가 아무리
   * 오래돼도 화면이 FAILED 에 갇히지 않는다. 칸을 비운 것 자체가 화면 변경이라 실시간 알림을 한 번 보내고, 칸이 이미 비었거나 보고가 똑같으면 알리지 않는다.
   */
  @Test
  void status_slotReport_clearsPaneBlockedMessage() throws Exception {
    // 먼저 정상 보고로 화면 상태를 맞춘다 — 그 뒤에는 칸 차단만 바뀌므로, 알림이 칸 비움에서만 나가는지 가릴 수 있다.
    report(key, slotReport("IDLE", "WP", null, null)).andExpect(status().isOk());
    dsl.update(AGENT_RUNTIME_SETTING)
        .set(AGENT_RUNTIME_SETTING.PANE_BLOCKED_MESSAGE, "설정 오류로 칸을 못 띄웠어요")
        .set(AGENT_RUNTIME_SETTING.PANE_BLOCKED_AT, OffsetDateTime.now())
        .where(AGENT_RUNTIME_SETTING.AGENT_USER_ID.eq(agent))
        .execute();
    appEvents.clear();

    report(key, slotReport("IDLE", "WP", null, null)).andExpect(status().isOk());

    Record row = settingOf(agent);
    assertThat(row.get(AGENT_RUNTIME_SETTING.PANE_BLOCKED_MESSAGE)).isNull();
    assertThat(row.get(AGENT_RUNTIME_SETTING.PANE_BLOCKED_AT)).isNull();
    assertThat(runtimeEvents()).isEqualTo(1);

    // 칸이 이미 비었고 보고도 같은 내용이면 화면에 보이는 것은 그대로 — 추가 알림은 없다(WP-1913).
    report(key, slotReport("IDLE", "WP", null, null)).andExpect(status().isOk());
    assertThat(runtimeEvents()).isEqualTo(1);
  }

  /**
   * 옛 generation 의 칸 보고는 지금 차단을 지우지 못한다 — 백스톱이 generation 을 보지 않으면 끝나는 중인 옛 Pod 의 상태 보고가 지금 새 차단을
   * 지워 화면이 「오류」를 잃는다(WP-1913 리뷰 반려 ③).
   */
  @Test
  void status_옛_generation_보고는_칸_차단을_지우지_못한다() throws Exception {
    // 먼저 정상 보고로 화면 상태를 맞춘다 — 그 뒤에는 칸 차단만 바뀌므로, 알림이 칸에서만 나는지 가릴 수 있다.
    report(key, slotReport("IDLE", "WP", null, null)).andExpect(status().isOk());
    long gen = settingOf(agent).get(AGENT_RUNTIME_SETTING.GENERATION);
    dsl.update(AGENT_RUNTIME_SETTING)
        .set(AGENT_RUNTIME_SETTING.PANE_BLOCKED_MESSAGE, "설정 오류로 칸을 못 띄웠어요")
        .set(AGENT_RUNTIME_SETTING.PANE_BLOCKED_AT, OffsetDateTime.now())
        .set(AGENT_RUNTIME_SETTING.PANE_BLOCKED_GENERATION, gen)
        .where(AGENT_RUNTIME_SETTING.AGENT_USER_ID.eq(agent))
        .execute();
    appEvents.clear();

    report(key, slotReport("IDLE", "WP", null, gen - 1)).andExpect(status().isOk());

    assertThat(settingOf(agent).get(AGENT_RUNTIME_SETTING.PANE_BLOCKED_MESSAGE))
        .isEqualTo("설정 오류로 칸을 못 띄웠어요");
    assertThat(runtimeEvents()).isZero();
  }

  /**
   * 가려진 옛 차단 사유를 비워도 실시간 알림은 나지 않는다 — 화면에 보이는 것이 그대로라서다(WP-1913 리뷰 반려 ③, 칸 비움 알림을 저장 원문이 아니라 읽을 때
   * 합치는 currentPaneBlocked 기준으로 바꾼 것을 고정). 칸 자체는 지금 generation 보고가 오면 비워 둔다.
   */
  @Test
  void status_가려진_칸_차단을_비워도_알리지_않는다() throws Exception {
    report(key, slotReport("IDLE", "WP", null, null)).andExpect(status().isOk());
    long gen = settingOf(agent).get(AGENT_RUNTIME_SETTING.GENERATION);
    // 옛 generation 에서 남은 차단 — 읽을 때 가려져 화면에는 보이지 않는다.
    dsl.update(AGENT_RUNTIME_SETTING)
        .set(AGENT_RUNTIME_SETTING.PANE_BLOCKED_MESSAGE, "옛 Pod 의 차단")
        .set(AGENT_RUNTIME_SETTING.PANE_BLOCKED_AT, OffsetDateTime.now())
        .set(AGENT_RUNTIME_SETTING.PANE_BLOCKED_GENERATION, gen - 1)
        .where(AGENT_RUNTIME_SETTING.AGENT_USER_ID.eq(agent))
        .execute();
    appEvents.clear();

    report(key, slotReport("IDLE", "WP", null, null)).andExpect(status().isOk());

    assertThat(settingOf(agent).get(AGENT_RUNTIME_SETTING.PANE_BLOCKED_MESSAGE)).isNull();
    assertThat(runtimeEvents()).isZero();
  }

  /**
   * 새 Pod 가 과거에 뜬 뒤 진입점이 차단을 남기고, 그 다음 도착한 **옛 Pod 의 늦은 IDLE 보고**는 칸을 그대로 둔다(WP-1913 리뷰 반려 ①) —
   * 옛/새는 보고에 실은 **Pod 시작 시각**으로 가른다. 서버가 보고를 받은 시각으로는 이 판정을 못 한다(옛 Pod 의 늦은 보고도 새 Pod 가 뜬 뒤에 도착해 받은
   * 시각이 늘 지금이다). 반대로 지금 Pod 자신의 보고는 칸을 비우고, 화면에 보이던 사유가 바뀌었으니 알림도 한 번 나간다.
   */
  @Test
  void status_새_파드가_과거에_뜬_뒤_도착한_옛_파드의_보고는_차단을_지우지_못한다() throws Exception {
    report(key, slotReport("IDLE", "WP", null, null)).andExpect(status().isOk());
    long gen = settingOf(agent).get(AGENT_RUNTIME_SETTING.GENERATION);

    // 새 Pod 가 과거에 떴다(10분 전) — 시각을 바꾼 뒤 화면 상태를 먼저 맞춘다(시각 변경이 알림에 섞이지 않게).
    OffsetDateTime newPodStartedAt = OffsetDateTime.now().minusMinutes(10);
    dsl.update(AGENT_RUNTIME_SETTING)
        .set(AGENT_RUNTIME_SETTING.STARTED_AT, newPodStartedAt)
        .where(AGENT_RUNTIME_SETTING.AGENT_USER_ID.eq(agent))
        .execute();
    report(key, slotReport("IDLE", "WP", null, gen)).andExpect(status().isOk());

    // 그 뒤 진입점이 차단을 남겼다.
    setPaneBlocked(gen);

    // 끝나는 중인 옛 Pod(1시간 전에 시작)의 늦은 IDLE 보고 — 같은 generation 이라도 칸을 비우지 않고 알리지도 않는다.
    report(key, slotReportWithPod("IDLE", "WP", null, gen, OffsetDateTime.now().minusHours(1)))
        .andExpect(status().isOk());
    assertThat(settingOf(agent).get(AGENT_RUNTIME_SETTING.PANE_BLOCKED_MESSAGE))
        .isEqualTo("설정 오류로 칸을 못 띄웠어요");
    assertThat(runtimeEvents()).isZero();

    // 지금 Pod(시작 시각이 같다)의 보고는 칸을 비우고 화면에 보이던 사유가 바뀌었으니 알린다.
    report(key, slotReportWithPod("IDLE", "WP", null, gen, newPodStartedAt))
        .andExpect(status().isOk());
    assertThat(settingOf(agent).get(AGENT_RUNTIME_SETTING.PANE_BLOCKED_MESSAGE)).isNull();
    assertThat(settingOf(agent).get(AGENT_RUNTIME_SETTING.PANE_BLOCKED_AT)).isNull();
    assertThat(runtimeEvents()).isEqualTo(1);
  }

  /**
   * Pod 시작 시각을 모르는 보고(옛 플러그인)는 그대로 믿는다(WP-1913 리뷰 반려 ①) — 플러그인을 아직 갈아끼우지 않은 이미지도 칸을 비워 화면이 FAILED 에
   * 갇히지 않게 한다(generation 없는 보고와 같은 취급).
   */
  @Test
  void status_파드_시각을_모르는_보고는_칸_차단을_비운다() throws Exception {
    report(key, slotReport("IDLE", "WP", null, null)).andExpect(status().isOk());
    long gen = settingOf(agent).get(AGENT_RUNTIME_SETTING.GENERATION);
    dsl.update(AGENT_RUNTIME_SETTING)
        .set(AGENT_RUNTIME_SETTING.STARTED_AT, OffsetDateTime.now().minusMinutes(10))
        .where(AGENT_RUNTIME_SETTING.AGENT_USER_ID.eq(agent))
        .execute();
    report(key, slotReport("IDLE", "WP", null, gen)).andExpect(status().isOk());
    setPaneBlocked(gen);

    report(key, slotReport("IDLE", "WP", null, gen)).andExpect(status().isOk());

    assertThat(settingOf(agent).get(AGENT_RUNTIME_SETTING.PANE_BLOCKED_MESSAGE)).isNull();
    assertThat(runtimeEvents()).isEqualTo(1);
  }

  /**
   * 30초 여유의 경계(WP-1913 리뷰 반려 ①) — `podStartedAt` 이 `started_at − 30초`(= {@code podStartCutoff})와
   * 같거나 뒤면 지금 Pod 로 보고, 그보다 앞서면 옛 Pod 로 본다(WP-1253 칸 거르기와 같은 여유). 문서가 말하는 경계를 코드가 지키는지 여기서 고정한다.
   */
  @Test
  void status_파드_시각은_시작_시각_30초_여유_경계로_가른다() throws Exception {
    report(key, slotReport("IDLE", "WP", null, null)).andExpect(status().isOk());
    long gen = settingOf(agent).get(AGENT_RUNTIME_SETTING.GENERATION);
    // 초 단위로 끊는다 — 클라이언트(gw-status)·kubelet startTime 을 모두 초 정밀로 보내므로 경계(정확히 30초)가
    // 나노초 때문에 어긋나지 않게 한다. 나노초를 남기면 DB 반올림이 시작 시각을 조금 늘려 -30초 보고가 걸러진다.
    OffsetDateTime startedAt = OffsetDateTime.now().withNano(0).minusMinutes(10);
    dsl.update(AGENT_RUNTIME_SETTING)
        .set(AGENT_RUNTIME_SETTING.STARTED_AT, startedAt)
        .where(AGENT_RUNTIME_SETTING.AGENT_USER_ID.eq(agent))
        .execute();
    report(key, slotReport("IDLE", "WP", null, gen)).andExpect(status().isOk());
    setPaneBlocked(gen);

    // 여유 안(시작 − 29초) — 지금 Pod 로 보아 칸을 비우고 화면이 바뀌었으니 알린다.
    report(key, slotReportWithPod("IDLE", "WP", null, gen, startedAt.minusSeconds(29)))
        .andExpect(status().isOk());
    assertThat(settingOf(agent).get(AGENT_RUNTIME_SETTING.PANE_BLOCKED_MESSAGE)).isNull();
    assertThat(runtimeEvents()).isEqualTo(1);

    // 경계값 그 자체(시작 − 30초) — 문서가 말하는 「이후」(같거나 뒤)에 들어가므로 지우고 알린다.
    setPaneBlocked(gen);
    report(key, slotReportWithPod("IDLE", "WP", null, gen, startedAt.minusSeconds(30)))
        .andExpect(status().isOk());
    assertThat(settingOf(agent).get(AGENT_RUNTIME_SETTING.PANE_BLOCKED_MESSAGE)).isNull();
    assertThat(runtimeEvents()).isEqualTo(1);

    // 여유 밖(시작 − 31초) — 옛 Pod 로 보아 칸을 그대로 두고 알리지도 않는다(setPaneBlocked 가 알림 기록을 비운다).
    setPaneBlocked(gen);
    report(key, slotReportWithPod("IDLE", "WP", null, gen, startedAt.minusSeconds(31)))
        .andExpect(status().isOk());
    assertThat(settingOf(agent).get(AGENT_RUNTIME_SETTING.PANE_BLOCKED_MESSAGE))
        .isEqualTo("설정 오류로 칸을 못 띄웠어요");
    assertThat(runtimeEvents()).isZero();
  }

  /**
   * generation 을 싣지 않은 옛 이미지의 차단(null)은 **지금 돌고 있는 Pod 의 generation(관찰 generation)** 과 견준다(WP-1913
   * 리뷰 반려 ②) — 원하는 generation 과 견주면 교체가 미뤄진 동안 지금 Pod 가 gen-1 로 보고해 칸이 영영 비워지지 않고 건강한 AI 가 FAILED 로
   * 남는다. 반대로 관찰 generation 보다 옛 generation 의 보고는 칸을 비우지 못한다(옛 Pod 늦은 보고 가림).
   */
  @Test
  void status_generation_없는_차단은_관찰_generation_과_겨룬다() throws Exception {
    report(key, slotReport("IDLE", "WP", null, null)).andExpect(status().isOk());
    long gen = settingOf(agent).get(AGENT_RUNTIME_SETTING.GENERATION);

    // 교체가 미뤄진 동안 지금 Pod 는 gen-1 로 떠 있다(관찰 generation = gen-1).
    setRow(agent, gen - 1, "IDLE", "RUN");
    report(key, slotReport("IDLE", "WP", null, gen - 1)).andExpect(status().isOk());
    // 옛 이미지가 generation 없이 남긴 차단 — pane_blocked_generation 칸이 비어 있다.
    setPaneBlocked(null);

    // 지금 Pod(gen-1)의 보고는 칸을 비우고 화면에 보이던 사유가 바뀌었으니 알린다.
    report(key, slotReport("IDLE", "WP", null, gen - 1)).andExpect(status().isOk());
    assertThat(settingOf(agent).get(AGENT_RUNTIME_SETTING.PANE_BLOCKED_MESSAGE)).isNull();
    assertThat(runtimeEvents()).isEqualTo(1);

    // 관찰 generation 은 gen 인데 옛 generation(gen-1)의 보고 — 칸을 비우지 못하고 알리지도 않는다.
    setRow(agent, gen, "IDLE", "RUN");
    report(key, slotReport("IDLE", "WP", null, gen)).andExpect(status().isOk());
    setPaneBlocked(null);
    report(key, slotReport("IDLE", "WP", null, gen - 1)).andExpect(status().isOk());

    assertThat(settingOf(agent).get(AGENT_RUNTIME_SETTING.PANE_BLOCKED_MESSAGE))
        .isEqualTo("설정 오류로 칸을 못 띄웠어요");
    assertThat(runtimeEvents()).isZero();
  }

  // ---- WP-1958 옛 Pod 의 늦은 보고 거르기 ----

  private static final OffsetDateTime POD_NEW = OffsetDateTime.now().withNano(0).minusMinutes(10);
  private static final OffsetDateTime POD_OLD = POD_NEW.minusMinutes(5);

  /** 관찰한 시작 시각(started_at)을 직접 맞춘다 — null 이면 runner 가 아직 관찰하지 못한 상태. */
  private void setStartedAt(OffsetDateTime startedAt) {
    dsl.update(AGENT_RUNTIME_SETTING)
        .set(AGENT_RUNTIME_SETTING.STARTED_AT, startedAt)
        .where(AGENT_RUNTIME_SETTING.AGENT_USER_ID.eq(agent))
        .execute();
  }

  /** 진입점 차단을 차단한 Pod 시작 시각과 함께 심어 둔다(시각 null 이면 옛 이미지의 차단). */
  private void setPaneBlockedByPod(OffsetDateTime podStartedAt) {
    dsl.update(AGENT_RUNTIME_SETTING)
        .set(AGENT_RUNTIME_SETTING.PANE_BLOCKED_MESSAGE, "설정 오류로 칸을 못 띄웠어요")
        .set(AGENT_RUNTIME_SETTING.PANE_BLOCKED_AT, OffsetDateTime.now())
        .set(AGENT_RUNTIME_SETTING.PANE_BLOCKED_POD_STARTED_AT, podStartedAt)
        .where(AGENT_RUNTIME_SETTING.AGENT_USER_ID.eq(agent))
        .execute();
  }

  private String slotState(String slotKey) {
    return dsl.select(AGENT_RUNTIME_SLOT_STATE.STATE)
        .from(AGENT_RUNTIME_SLOT_STATE)
        .where(AGENT_RUNTIME_SLOT_STATE.AGENT_USER_ID.eq(agent))
        .and(AGENT_RUNTIME_SLOT_STATE.SLOT_KEY.eq(slotKey))
        .fetchOne(AGENT_RUNTIME_SLOT_STATE.STATE);
  }

  /** 같은 generation 으로 재시작해도 새 Pod 가 먼저 보고했으면 옛 Pod 의 늦은 WORKING 은 저장되지 않는다. */
  @Test
  void status_같은_generation_재시작_뒤_옛_파드의_늦은_WORKING_은_저장되지_않는다() throws Exception {
    report(key, slotReportWithPod("IDLE", "X", null, null, POD_NEW)).andExpect(status().isOk());

    report(key, slotReportWithPod("WORKING", "X", "WP-9", null, POD_OLD))
        .andExpect(status().isOk());

    assertThat(settingOf(agent).get(AGENT_RUNTIME_SETTING.AGENT_STATE)).isEqualTo("IDLE");
    assertThat(slotState("X")).isEqualTo("IDLE");
  }

  /** runner 가 새 Pod 를 아직 관찰하지 못해도(started_at=옛 Pod) 새 Pod 가 보고한 뒤의 옛 Pod 보고는 버려진다. */
  @Test
  void status_runner_관찰_전에도_새_파드_보고_뒤_옛_파드_보고는_버려진다() throws Exception {
    setStartedAt(POD_OLD);
    report(key, slotReportWithPod("IDLE", "A", null, null, POD_NEW)).andExpect(status().isOk());

    report(key, slotReportWithPod("WORKING", "B", "WP-9", null, POD_OLD))
        .andExpect(status().isOk());

    assertThat(slotKeysOf(agent)).containsExactly("A");
  }

  /** 옛 Pod 칸이 새 Pod 첫 보고보다 먼저 저장돼 있었으면 새 Pod 첫 보고가 그 칸을 뺀다. */
  @Test
  void status_새_파드_첫_보고가_먼저_늦게_저장된_옛_파드_칸을_뺀다() throws Exception {
    setStartedAt(POD_OLD);
    report(key, slotReportWithPod("WORKING", "B", "WP-9", null, POD_OLD))
        .andExpect(status().isOk());
    assertThat(slotKeysOf(agent)).containsExactly("B");

    report(key, slotReportWithPod("IDLE", "A", null, null, POD_NEW)).andExpect(status().isOk());

    assertThat(slotKeysOf(agent)).containsExactly("A");
    assertThat(settingOf(agent).get(AGENT_RUNTIME_SETTING.AGENT_STATE)).isEqualTo("IDLE");
  }

  /** 서버 시각보다 30초 넘게 앞선 Pod 시각은 시계 이상으로 보고 버린다 — 시각 없는 보고처럼 저장하고, 기준을 올리지 않는다. */
  @Test
  void status_미래_파드_시각은_무시된다() throws Exception {
    report(key, slotReportWithPod("IDLE", "A", null, null, OffsetDateTime.now().plusMinutes(10)))
        .andExpect(status().isOk());

    assertThat(slotKeysOf(agent)).containsExactly("A");
    assertThat(settingOf(agent).get(AGENT_RUNTIME_SETTING.REPORTED_POD_STARTED_AT)).isNull();

    report(key, slotReportWithPod("IDLE", "B", null, null, POD_NEW)).andExpect(status().isOk());
    assertThat(slotKeysOf(agent)).contains("B");
  }

  /** 차단한 Pod 보다 앞선 Pod 의 칸 보고는 차단을 비우지 못하고, 같은 Pod 의 보고는 비운다. */
  @Test
  void status_백스톱_차단한_파드보다_앞선_파드의_칸_보고는_차단을_비우지_못한다() throws Exception {
    setStartedAt(POD_OLD);
    setPaneBlockedByPod(POD_NEW);

    report(key, slotReportWithPod("IDLE", "A", null, null, POD_OLD)).andExpect(status().isOk());
    assertThat(settingOf(agent).get(AGENT_RUNTIME_SETTING.PANE_BLOCKED_MESSAGE))
        .isEqualTo("설정 오류로 칸을 못 띄웠어요");

    report(key, slotReportWithPod("IDLE", "A", null, null, POD_NEW)).andExpect(status().isOk());
    assertThat(settingOf(agent).get(AGENT_RUNTIME_SETTING.PANE_BLOCKED_MESSAGE)).isNull();
  }

  /**
   * WP-1958 실제 흐름 — 새 Pod(T2)의 BLOCKED 가 칸 차단 보고로 지금 Pod 시작을 올린 뒤, 옛 Pod(T1 &lt; T2 − 30초)의 늦은 칸 상태
   * 보고가 오면 보고 전체가 버려진다: 차단은 남고 칸 행도 쓰이지 않는다.
   */
  @Test
  void status_칸_차단_보고로_올라간_파드_시각보다_앞선_상태_보고는_통째로_버려진다() throws Exception {
    useTenant(1L);
    mvc.perform(
            put("/api/v1/agent-runtime/me/pane")
                .header("Authorization", "Bearer " + key)
                .contentType(MediaType.APPLICATION_JSON)
                .content(
                    om.writeValueAsString(
                        Map.of(
                            "state", "BLOCKED",
                            "message", "설정 오류로 칸을 못 띄웠어요",
                            "podStartedAt", POD_NEW))))
        .andExpect(status().isNoContent());
    useTenant(1L);
    assertThat(settingOf(agent).get(AGENT_RUNTIME_SETTING.REPORTED_POD_STARTED_AT)).isNotNull();

    report(key, slotReportWithPod("IDLE", "A", null, null, POD_OLD)).andExpect(status().isOk());

    assertThat(settingOf(agent).get(AGENT_RUNTIME_SETTING.PANE_BLOCKED_MESSAGE))
        .isEqualTo("설정 오류로 칸을 못 띄웠어요");
    assertThat(slotKeysOf(agent)).isEmpty();
  }

  /** 차단한 Pod 시각이 없는 차단(옛 이미지)은 지금 규칙대로 관찰한 시작 시각과 견준다. */
  @Test
  void status_시각_없는_차단은_지금_백스톱_규칙대로() throws Exception {
    setStartedAt(POD_OLD);
    setPaneBlockedByPod(null);

    report(key, slotReportWithPod("IDLE", "A", null, null, POD_OLD)).andExpect(status().isOk());

    assertThat(settingOf(agent).get(AGENT_RUNTIME_SETTING.PANE_BLOCKED_MESSAGE)).isNull();
  }

  /** 지금 Pod 시작보다 29초 앞선 Pod 시각은 시계 차이 여유 안이라 지금 Pod 로 본다(버리지 않는다). */
  @Test
  void status_29초_앞선_파드_시각은_지금_파드로_본다() throws Exception {
    setStartedAt(POD_NEW);

    report(key, slotReportWithPod("WORKING", "A", "WP-9", null, POD_NEW.minusSeconds(29)))
        .andExpect(status().isOk());

    assertThat(slotState("A")).isEqualTo("WORKING");
  }

  /** 진입점 차단을 심어 둔다 — 보고 generation 은 null(옛 이미지)도 받는다. */
  private void setPaneBlocked(Long blockedGeneration) {
    dsl.update(AGENT_RUNTIME_SETTING)
        .set(AGENT_RUNTIME_SETTING.PANE_BLOCKED_MESSAGE, "설정 오류로 칸을 못 띄웠어요")
        .set(AGENT_RUNTIME_SETTING.PANE_BLOCKED_AT, OffsetDateTime.now())
        .set(AGENT_RUNTIME_SETTING.PANE_BLOCKED_GENERATION, blockedGeneration)
        .where(AGENT_RUNTIME_SETTING.AGENT_USER_ID.eq(agent))
        .execute();
    appEvents.clear();
  }

  /** 두 워크스페이스에 속한 AI — 설정은 테넌트 2 에만 있다. [tenant2, loc2, agent] */
  private long[] agentInTwoTenants() {
    long tenant2 = TestFixtures.createTenant(dsl, "ACTIVE");
    useTenant(tenant2);
    long admin2 = TestFixtures.activeMemberOfCurrentTenant(dsl, TestFixtures.createHuman(dsl));
    long loc2 =
        locationService
            .create(admin2, new CreateAgentLocationRequest("L2", null, 3))
            .location()
            .id();
    long multi =
        TestFixtures.activeMemberOfCurrentTenant(dsl, TestFixtures.createAgentNoToken(dsl));
    TestFixtures.ensureActiveMember(dsl, multi, 1L);
    settingService.put(
        admin2, multi, new PutAgentRuntimeSettingRequest("claude-code", null, Map.of(), null));
    settingService.start(admin2, multi);
    return new long[] {tenant2, loc2, multi};
  }

  /**
   * 두 워크스페이스에 속한 AI 의 관리자 발급 키(워크스페이스에 묶이지 않음) — 테넌트 헤더로 2 를 밝히면 그 워크스페이스에 저장하고 원하는 상태를 계산한다. 헤더가
   * 없으면 테넌트가 정해지지 않아(기존 인증 규칙) 아무것도 저장하지 않고 RUN 이다.
   */
  @Test
  void status_forAgentInTwoTenants_withTenantHeader_storesInThatTenant() throws Exception {
    long[] seeded = agentInTwoTenants();
    long tenant2 = seeded[0];
    long loc2 = seeded[1];
    long multi = seeded[2];
    long g = fx.generationOf(multi);
    String multiKey = "ak_unboundMultiTenantKey0001";
    keyRepo.insert(
        multi, multiKey.substring(0, 12), CapabilityTokens.sha256Hex(multiKey), "수동", admin);
    appEvents.clear();

    // 헤더 없음 — 테넌트가 정해지지 않는다. 테스트 스레드에 남은 TenantContext 가 해석을 대신하지 않게 비운다.
    TenantContext.clear();
    mvc.perform(
            put(URL)
                .header("Authorization", "Bearer " + multiKey)
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"state\":\"IDLE\",\"generation\":" + g + "}"))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.desired").value("RUN"));
    useTenant(tenant2);
    assertThat(settingOf(multi).get(AGENT_RUNTIME_SETTING.AGENT_STATE)).isNull();
    assertThat(changedEvents()).isZero();

    // 헤더 2 — 그 워크스페이스의 설정에 저장하고, 뜬 적 없는(교체 대기) AI 의 쉬는 중 보고라 이벤트가 나간다.
    useTenant(tenant2);
    mvc.perform(
            put(URL)
                .header("Authorization", "Bearer " + multiKey)
                .header(AgentTenantResolver.TENANT_HEADER, tenant2)
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"state\":\"IDLE\",\"generation\":" + g + "}"))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.desired").value("RUN"));
    useTenant(tenant2);
    assertThat(settingOf(multi).get(AGENT_RUNTIME_SETTING.AGENT_STATE)).isEqualTo("IDLE");
    assertThat(appEvents.stream(AgentRuntimeDesiredChanged.class).toList())
        .containsExactly(new AgentRuntimeDesiredChanged(tenant2, loc2));
    useTenant(1L);
  }

  /**
   * Works 가 테넌트 2 에서 자동 발급한 키는 그 워크스페이스에 묶인다(WP-1253) — 헤더 없이도 테넌트 2 에 저장되고, 테넌트 1 을 밝히면 그 워크스페이스의
   * 멤버여도 401 이다.
   */
  @Test
  void status_withManagedKeyOfOtherTenant_usesBoundTenantWithoutHeader() throws Exception {
    long[] seeded = agentInTwoTenants();
    long tenant2 = seeded[0];
    long multi = seeded[2];
    long g = fx.generationOf(multi);
    String managedKey = keyService.issueManaged(multi, tenant2, null, null, "L2").plaintext();

    TenantContext.clear();
    mvc.perform(
            put(URL)
                .header("Authorization", "Bearer " + managedKey)
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"state\":\"WORKING\",\"generation\":" + g + "}"))
        .andExpect(status().isOk());
    useTenant(tenant2);
    assertThat(settingOf(multi).get(AGENT_RUNTIME_SETTING.AGENT_STATE)).isEqualTo("WORKING");
    // 보고 시각도 남는다 — 지금 Pod 가 뜨기 전 보고를 적용 판정에서 거르는 기준.
    assertThat(settingOf(multi).get(AGENT_RUNTIME_SETTING.AGENT_REPORTED_AT)).isNotNull();

    TenantContext.clear();
    mvc.perform(
            put(URL)
                .header("Authorization", "Bearer " + managedKey)
                .header(AgentTenantResolver.TENANT_HEADER, 1L)
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"state\":\"IDLE\"}"))
        .andExpect(status().isUnauthorized());
    useTenant(1L);
  }

  /**
   * 이번 보고가 지우는 차단으로 응답을 정하지 않는다(WP-1969) — 도는 Pod 의 저장된 차단이 있고 적용이 쉴 때로 미뤄진 AI 의 IDLE 보고가 와도, 보고
   * 시각이 관찰한 시작 시각(30초 여유 안)보다 앞서면 쉬는 중으로 치지 않으므로 지운 뒤에는 DRAIN 이고 runner 의 applyNow 도 거짓이다.
   */
  @Test
  void status_차단을_지우는_보고의_응답은_지운_뒤_행으로_정한다() throws Exception {
    long g = fx.generationOf(agent);
    setRow(agent, g - 1, "IDLE", "RUN");
    dsl.update(AGENT_RUNTIME_SETTING)
        .set(AGENT_RUNTIME_SETTING.STARTED_AT, OffsetDateTime.now().plusSeconds(5))
        .set(AGENT_RUNTIME_SETTING.PHASE, "RUNNING")
        .set(AGENT_RUNTIME_SETTING.PANE_BLOCKED_MESSAGE, "설정 오류로 칸을 못 띄웠어요")
        .set(AGENT_RUNTIME_SETTING.PANE_BLOCKED_AT, OffsetDateTime.now())
        .set(AGENT_RUNTIME_SETTING.PANE_BLOCKED_GENERATION, g - 1)
        .where(AGENT_RUNTIME_SETTING.AGENT_USER_ID.eq(agent))
        .execute();

    report(key, slotReport("IDLE", "WP", null, g - 1))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.desired").value("DRAIN"));

    assertThat(settingOf(agent).get(AGENT_RUNTIME_SETTING.PANE_BLOCKED_MESSAGE)).isNull();
    String runnerToken = locationService.rotateToken(admin, location).plaintextToken();
    useTenant(1L);
    String json =
        mvc.perform(
                get("/api/v1/agent-runtime/runner/desired")
                    .header("Authorization", "Bearer " + runnerToken))
            .andExpect(status().isOk())
            .andReturn()
            .getResponse()
            .getContentAsString();
    useTenant(1L);
    tools.jackson.databind.JsonNode agents = om.readTree(json).get("agents");
    assertThat(agents).hasSize(1);
    assertThat(agents.get(0).get("applyNow").asBoolean()).isFalse();
  }

  // ---- WP-1968 상태 보고를 Pod 정체로 받고/버린다 ----

  /** runner 가 관찰한 Pod 정체와 보고가 올려 둔 Pod 시작 기준(reported_pod_started_at)을 직접 맞춘다. */
  private void setObservedPod(String observedPodUid, OffsetDateTime reportedPodStartedAt) {
    dsl.update(AGENT_RUNTIME_SETTING)
        .set(AGENT_RUNTIME_SETTING.OBSERVED_POD_UID, observedPodUid)
        .set(AGENT_RUNTIME_SETTING.REPORTED_POD_STARTED_AT, reportedPodStartedAt)
        .where(AGENT_RUNTIME_SETTING.AGENT_USER_ID.eq(agent))
        .execute();
  }

  /**
   * 기준 없는 ADOPT 표시를 남긴 서버 시각(basisless_marked_at)을 직접 맞춘다 — 표시 잠금의 60초 창(서버 시각 기준)을 재현하기 위해(WP-2026
   * 3차 반려 ①). 테스트가 창 밖·창 안을 각각 재현할 수 있게 시간을 되돌린다.
   */
  private void setBasislessMarkedAt(OffsetDateTime markedAt) {
    dsl.update(AGENT_RUNTIME_SETTING)
        .set(AGENT_RUNTIME_SETTING.BASISLESS_MARKED_AT, markedAt)
        .where(AGENT_RUNTIME_SETTING.AGENT_USER_ID.eq(agent))
        .execute();
  }

  /** 바로 앞에 쓰이던 Pod 정체(previous_pod_uid)를 직접 심는다 — 끝나는 중인 옛 Pod 의 늦은 보고를 재현하기 위해(WP-1968 반려 ①). */
  private void setPreviousPodUid(String previousPodUid) {
    dsl.update(AGENT_RUNTIME_SETTING)
        .set(AGENT_RUNTIME_SETTING.PREVIOUS_POD_UID, previousPodUid)
        .where(AGENT_RUNTIME_SETTING.AGENT_USER_ID.eq(agent))
        .execute();
  }

  /**
   * 정체가 같아도 저장된 기준보다 이른 시작의 보고는 저장하지 않는다(WP-1968 5차 반려 ②) — 같은 Pod 안 컨테이너 재시작(restartPolicy Always
   * → uid 고정)에서는 정체가 같아도 재시작 전 컨테이너의 늦은 보고가 기준을 되돌리고 칸을 덮어 WP-1958 이 회귀한다. 응답은 저장된 행 기준 그대로다.
   */
  @Test
  void status_정체가_같아도_이른_시작_보고는_저장하지_않는다() throws Exception {
    // 저장된 기준이 보고 값보다 5분 뒤(재시작한 컨테이너가 올려 둔 값) — 정체는 같지만 보고한 시작은 앞 컨테이너 쪽이다.
    setObservedPod("pod-a", POD_NEW.plusMinutes(5));

    report(key, slotReportWithIdentity("WORKING", "X", "WP-9", null, POD_NEW, "pod-a"))
        .andExpect(status().isOk());

    // 칸·합친 상태·기준 어느 것도 쓰지 않는다.
    assertThat(slotKeysOf(agent)).isEmpty();
    assertThat(settingOf(agent).get(AGENT_RUNTIME_SETTING.AGENT_STATE)).isNull();
    assertThat(settingOf(agent).get(AGENT_RUNTIME_SETTING.REPORTED_POD_STARTED_AT).toInstant())
        .isEqualTo(POD_NEW.plusMinutes(5).toInstant());
  }

  /**
   * 정체가 같은 지금 Pod 는 시계와 상관없이 자기 진입점 차단을 비운다(WP-1968 반려 ④) — 빠른 시계의 죽은 옛 Pod 가 높은 {@code
   * pane_blocked_pod_started_at} 을 남기면, 지금 Pod 의 정상 보고가 「지금 Pod 보다 이른 옛 보고」로 오판돼 「오류」가 영영 남았다.
   */
  @Test
  void status_정체가_같으면_지난_Pod_가_남긴_차단을_비운다() throws Exception {
    long gen = settingOf(agent).get(AGENT_RUNTIME_SETTING.GENERATION);
    setObservedPod("pod-b", POD_NEW);
    setPreviousPodUid("pod-a");
    // 빠른 시계의 죽은 옛 Pod 가 남긴 차단 — 차단한 시작 시각이 지금 Pod 시작보다 뒤라 시계 판정으로는 비워지지 않는다.
    dsl.update(AGENT_RUNTIME_SETTING)
        .set(AGENT_RUNTIME_SETTING.PANE_BLOCKED_MESSAGE, "설정 오류로 칸을 못 띄웠어요")
        .set(AGENT_RUNTIME_SETTING.PANE_BLOCKED_AT, OffsetDateTime.now())
        .set(AGENT_RUNTIME_SETTING.PANE_BLOCKED_GENERATION, gen)
        .set(AGENT_RUNTIME_SETTING.PANE_BLOCKED_POD_STARTED_AT, POD_NEW.plusMinutes(5))
        .where(AGENT_RUNTIME_SETTING.AGENT_USER_ID.eq(agent))
        .execute();

    report(key, slotReportWithIdentity("WORKING", "X", "WP-9", null, POD_NEW, "pod-b"))
        .andExpect(status().isOk());

    assertThat(settingOf(agent).get(AGENT_RUNTIME_SETTING.PANE_BLOCKED_MESSAGE)).isNull();
    assertThat(settingOf(agent).get(AGENT_RUNTIME_SETTING.PANE_BLOCKED_POD_STARTED_AT)).isNull();
  }

  /**
   * **지난** Pod 의 보고는 저장하지 않는다(버리기) — 보고의 Pod 정체가 바로 앞 정체(끝나는 중인 옛 Pod)면 칸·합친 상태·기준 어느 것도 쓰지 않고, 상태
   * 엔드포인트는 오늘 옛 Pod 거절과 같이 HTTP 200 + 응답 `desired` 는 저장된 행 기준이다(여기서는 desired=STOP → DRAIN, 칸이 쓰였다면
   * WORKING 저장과 기준 이동이 드러난다). 지금 정체와 **다른** 보고(재시작 직후 새 Pod)는 버리지 않고 지금 Pod 로 받아진다(WP-1968 반려 ①).
   */
  @Test
  void status_지난_Pod_의_보고는_저장하지_않고_저장된_행_기준을_준다() throws Exception {
    setObservedPod("pod-a", null);
    setPreviousPodUid("pod-b");
    setRow(agent, null, "IDLE", "STOP");

    report(key, slotReportWithIdentity("WORKING", "X", "WP-9", null, POD_NEW, "pod-b"))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.desired").value("DRAIN"));

    assertThat(slotKeysOf(agent)).isEmpty();
    assertThat(settingOf(agent).get(AGENT_RUNTIME_SETTING.AGENT_STATE)).isNull();
    assertThat(settingOf(agent).get(AGENT_RUNTIME_SETTING.REPORTED_POD_STARTED_AT)).isNull();
    // 관찰 정체도 되돌아가지 않는다(지금 Pod 를 옛 Pod 로 뒤집지 않는다).
    assertThat(settingOf(agent).get(AGENT_RUNTIME_SETTING.OBSERVED_POD_UID)).isEqualTo("pod-a");
  }

  /**
   * 관찰이 아직 옛 정체를 가리키는 동안에 온 새 Pod 의 첫 보고도 지금 Pod 로 받아들인다(WP-1968 반려 ①) — runner 관찰(약 60초)을 기다리는 동안
   * 재시작 직후 새 Pod 의 보고가 버려지지 않게 한다. 칸은 그 보고로 쓰이고, 지금 정체는 바로 앞 정체로 미뤄 둔다(지연 도착한 옛 Pod 보고가 되돌리지 못하게).
   * 관찰이 정체와 함께 시작 시각도 밝혔다고 본다 — 갈아끼움을 막는 굳힘은 **표시**({@code basisless_pod_uid})가 있는 자리(기준 없이 ADOPT
   * 로만 밝힌 정체, WP-2026 리뷰 반려 ①)에만 걸려, 시각 없는 관찰 자리에서는 다른 정체도 ADOPT 로 받는다(반려 ②).
   */
  @Test
  void status_보고가_밝힌_정체는_관찰_없이_지금_Pod_로_받는다() throws Exception {
    setObservedPod("pod-old", null);
    setStartedAt(POD_NEW); // 관찰이 밝힌 지금 Pod 시작 — 시각 없는 관찰 자리와 갈리게(둘 다 ADOPT, 표시는 기준 없는 자리에만 남는다)
    setRow(agent, null, "IDLE", "RUN");

    report(key, slotReportWithIdentity("WORKING", "X", "WP-9", null, POD_NEW, "pod-new"))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.desired").value("RUN"));

    assertThat(slotKeysOf(agent)).containsExactly("X");
    assertThat(slotState("X")).isEqualTo("WORKING");
    assertThat(settingOf(agent).get(AGENT_RUNTIME_SETTING.OBSERVED_POD_UID)).isEqualTo("pod-new");
    assertThat(settingOf(agent).get(AGENT_RUNTIME_SETTING.PREVIOUS_POD_UID)).isEqualTo("pod-old");
    assertThat(settingOf(agent).get(AGENT_RUNTIME_SETTING.REPORTED_POD_STARTED_AT).toInstant())
        .isEqualTo(POD_NEW.toInstant());

    // 그 뒤 옛 Pod 의 늦은 보고는 이미 정체가 밝혀진 뒤라 버려진다 — 칸이 옛 Pod 로 바뀌지 않는다.
    report(key, slotReportWithIdentity("IDLE", "X", null, null, POD_OLD, "pod-old"))
        .andExpect(status().isOk());
    assertThat(slotState("X")).isEqualTo("WORKING");
    assertThat(settingOf(agent).get(AGENT_RUNTIME_SETTING.OBSERVED_POD_UID)).isEqualTo("pod-new");
  }

  /**
   * 정체가 없는 보고(관찰 정체 null + 보고 `podUid` 없음 — 옛 플러그인)는 정체 판정이 UNKNOWN 이라 지금 시각 규칙이 그대로다: 지금 Pod 보다
   * 30초 넘게 앞선 옛 Pod 보고는 칸을 쓰지 않고 버리고, 정상 보고의 기준은 기존처럼 max 로 올라간다(Review Focus 1·5 — 정체를 싣지 않는 이미지의
   * 동작이 바뀌지 않음을 고정)(WP-1968).
   */
  @Test
  void status_정체가_없는_보고는_시각_규칙_그대로다() throws Exception {
    setStartedAt(POD_NEW); // 관찰 정체(OBSERVED_POD_UID)는 그대로 null

    report(key, slotReportWithPod("IDLE", "A", null, null, POD_NEW)).andExpect(status().isOk());
    assertThat(settingOf(agent).get(AGENT_RUNTIME_SETTING.REPORTED_POD_STARTED_AT).toInstant())
        .isEqualTo(POD_NEW.toInstant());

    report(key, slotReportWithPod("WORKING", "B", "WP-9", null, POD_OLD))
        .andExpect(status().isOk());

    assertThat(slotKeysOf(agent)).containsExactly("A");
    assertThat(settingOf(agent).get(AGENT_RUNTIME_SETTING.AGENT_STATE)).isEqualTo("IDLE");
    // 옛 Pod 보고는 기준도 올리지 않는다.
    assertThat(settingOf(agent).get(AGENT_RUNTIME_SETTING.REPORTED_POD_STARTED_AT).toInstant())
        .isEqualTo(POD_NEW.toInstant());
  }

  /**
   * 관찰 정체는 있는데 보고에 정체가 없는 보고(이미 배포된 옛 이미지)도 UNKNOWN 이라 시각 규칙으로만 가른다(WP-1968 Review Focus 5) — 관찰
   * 정체가 있다는 이유로 거절하지 않고, 정상 보고는 받아 기준을 올린다. 위 「정체가 없는 보고」(관찰까지 없는 쪽)와 짝을 이뤄, 정체를 싣지 않는 이미지의 동작이 관찰
   * 유무와 상관없이 그대로임을 고정한다.
   */
  @Test
  void status_관찰_정체가_있어도_보고에_정체가_없으면_시각_규칙_그대로다() throws Exception {
    setStartedAt(POD_NEW);
    setObservedPod("pod-a", null); // 관찰 정체는 있고, 보고에는 podUid 가 없다

    report(key, slotReportWithPod("IDLE", "A", null, null, POD_NEW)).andExpect(status().isOk());
    assertThat(settingOf(agent).get(AGENT_RUNTIME_SETTING.AGENT_STATE)).isEqualTo("IDLE");
    assertThat(settingOf(agent).get(AGENT_RUNTIME_SETTING.REPORTED_POD_STARTED_AT).toInstant())
        .isEqualTo(POD_NEW.toInstant());

    // 정체로 거절하지 않으므로 버려짐은 시각 규칙이 맡는다 — 30초 넘게 이른 옛 Pod 보고는 기존처럼 칸을 쓰지 않는다.
    report(key, slotReportWithPod("WORKING", "B", "WP-9", null, POD_OLD))
        .andExpect(status().isOk());

    assertThat(slotKeysOf(agent)).containsExactly("A");
    assertThat(settingOf(agent).get(AGENT_RUNTIME_SETTING.REPORTED_POD_STARTED_AT).toInstant())
        .isEqualTo(POD_NEW.toInstant());
  }

  /** runner 관찰 한 건을 정체·phase·시작 시각과 함께 보낸다 — 배포 직후 롤링 재시작을 재현하기 위해(WP-1968 2차 반려 ①). */
  private void observe(String podUid, OffsetDateTime startedAt, String phase) {
    Long loc = settingOf(agent).get(AGENT_RUNTIME_SETTING.LOCATION_ID);
    settings.updateObserved(
        loc == null ? 0L : loc,
        true,
        List.of(
            new RunnerObservedAgent(
                agent, null, phase, null, null, null, startedAt, null, podUid)));
  }

  /**
   * 배포 직후 롤링 재시작 — 새 Pod B 보고가 ADOPT 로 정체를 채운 뒤(previous 는 비어 있음) 늦게 도착한 옛 Pod A 관찰이 정체를 뒤집지 않고, B
   * 의 다음 보고도 그대로 저장된다(WP-1968 2차 반려 ①) — 뒤집히면 observed=A·previous=B 가 돼 B 의 보고는 영영 OTHER(상태 버림·칸
   * 409 무한)이고, B 관찰은 previous=B 라 stale 로 걸려 스스로 회복되지 않는다.
   */
  @Test
  void status_배포_직후_새_Pod_보고_뒤_옛_Pod_관찰이_정체를_뒤집지_못한다() throws Exception {
    // 배포 직후 — observed·previous 가 비어 있어 새 Pod B 의 첫 보고가 ADOPT 로 정체를 밝힌다.
    report(key, slotReportWithIdentity("WORKING", "X", "WP-9", null, POD_NEW, "pod-b"))
        .andExpect(status().isOk());
    assertThat(settingOf(agent).get(AGENT_RUNTIME_SETTING.OBSERVED_POD_UID)).isEqualTo("pod-b");
    assertThat(settingOf(agent).get(AGENT_RUNTIME_SETTING.PREVIOUS_POD_UID)).isNull();
    assertThat(slotState("X")).isEqualTo("WORKING");

    // 아직 끝나는 중인 옛 Pod A 를 늦게 관찰한다 — 지난 정체라 아예 받지 않는다(정체·시각이 되돌아가지 않는다).
    observe("pod-a", POD_OLD, "RUNNING");
    assertThat(settingOf(agent).get(AGENT_RUNTIME_SETTING.OBSERVED_POD_UID)).isEqualTo("pod-b");
    assertThat(settingOf(agent).get(AGENT_RUNTIME_SETTING.PREVIOUS_POD_UID)).isNull();
    assertThat(settingOf(agent).get(AGENT_RUNTIME_SETTING.STARTED_AT).toInstant())
        .isEqualTo(POD_NEW.toInstant());

    // B 의 다음 보고는 교착 없이 MATCH 로 저장된다.
    report(key, slotReportWithIdentity("IDLE", "X", null, null, POD_NEW, "pod-b"))
        .andExpect(status().isOk());
    assertThat(slotState("X")).isEqualTo("IDLE");
    assertThat(settingOf(agent).get(AGENT_RUNTIME_SETTING.AGENT_STATE)).isEqualTo("IDLE");
  }

  /**
   * 끝나는 중인 옛 Pod 관찰은 previous 가 비어 있어도 정체를 되돌리지 않는다(WP-1968 2차 반려 ①) — 시작 시각이 지금과 같아 시계로는 잡히지 않아도,
   * 끝나는 중(STOPPING·STOPPED·시작이 이르지 않은 FAILED)의 정체가 다른 관찰은 지금 정체를 밝힌 보고를 무력화하지 않는다. 끝나지 않은 정체가 다른
   * 관찰(정체를 밝히는 첫 관찰)은 그대로 받아 정체를 갈아끼운다 — 필터가 과잉이 아님을 함께 고정한다.
   */
  @Test
  void status_끝나는_중인_옛_Pod_관찰은_previous_없이도_정체를_되돌리지_못한다() throws Exception {
    // 보고가 방금 ADOPT 한 정체(pod-b) — previous 는 비어 있고 시작 시각만 B 의 것으로 바뀌어 있다.
    setObservedPod("pod-b", POD_NEW);
    setStartedAt(POD_NEW);

    observe("pod-a", POD_NEW, "STOPPED");
    assertThat(settingOf(agent).get(AGENT_RUNTIME_SETTING.OBSERVED_POD_UID)).isEqualTo("pod-b");
    assertThat(settingOf(agent).get(AGENT_RUNTIME_SETTING.PREVIOUS_POD_UID)).isNull();

    observe("pod-a", POD_NEW, "RUNNING");
    assertThat(settingOf(agent).get(AGENT_RUNTIME_SETTING.OBSERVED_POD_UID)).isEqualTo("pod-a");
    assertThat(settingOf(agent).get(AGENT_RUNTIME_SETTING.PREVIOUS_POD_UID)).isEqualTo("pod-b");
  }

  /**
   * 새로 뜬 실패 Pod 의 관찰이 받아진다(WP-1968 3차 반려 ①) — FAILED 를 무조건 끝나는 중 phase 로 넣어 두면 지금 정체(이전 Pod)를 가리키는
   * 행에 새 Pod 의 FAILED 관찰이 매번 버려져, ImagePullBackOff 같은 「오류」가 화면에 안 뜬다. 시작이 이르지 않은(끝나는 중인)FAILED 는
   * 그대로 걸린다.
   */
  @Test
  void status_실패한_새_Pod_첫_관찰이_버려지지_않는다() throws Exception {
    // 지금 Pod(pod-a, 시작 POD_OLD)보다 뒤에 뜬 실패 Pod(pod-b) — 관찰이 받아져 정체를 갈아끼운다.
    setObservedPod("pod-a", POD_OLD);
    setStartedAt(POD_OLD);

    observe("pod-b", POD_NEW, "FAILED");

    assertThat(settingOf(agent).get(AGENT_RUNTIME_SETTING.OBSERVED_POD_UID)).isEqualTo("pod-b");
    assertThat(settingOf(agent).get(AGENT_RUNTIME_SETTING.PREVIOUS_POD_UID)).isEqualTo("pod-a");

    // 바로 앞 정체(previous)의 FAILED 관찰은 끝나는 중인 옛 Pod 라 그대로 지난 정체다.
    observe("pod-a", POD_OLD, "FAILED");
    assertThat(settingOf(agent).get(AGENT_RUNTIME_SETTING.OBSERVED_POD_UID)).isEqualTo("pod-b");
    assertThat(settingOf(agent).get(AGENT_RUNTIME_SETTING.PREVIOUS_POD_UID)).isEqualTo("pod-a");
  }

  /**
   * 서버 시각보다 30초 넘게 앞선 Pod 시작(시계 이상)의 첫 보고는 정체 미확정이라도 지금 Pod 로 받아 저장한다(WP-2026) — 관찰 보고에 정체를 싣지 못하는
   * 구 runner 는 이 조합에서 영구 OTHER 로 버려졌다.
   */
  @Test
  void status_시계_이상으로_걸러진_시각의_첫_보고는_정체를_받는다() throws Exception {
    // OBSERVED_POD_UID · STARTED_AT · REPORTED_POD_STARTED_AT 모두 비어 있는 상태(정체 미확정)에서,
    // podStartedAt 을 서버 시각보다 40초 앞(30초 여유 밖)으로 보고하고 podUid 를 함께 싣는다.
    OffsetDateTime skewStart = OffsetDateTime.now().plusSeconds(40);

    // 기대: 저장 없이 버려지지 않고(정체 미확정 + 시계 이상은 OTHER 가 아니라 ADOPT) 저장·응답까지 이번 보고가 반영된다.
    // 응답 값은 채택/거절 어느 쪽이든 RUN — 판별은 아래 저장 단언이 한다.
    report(key, slotReportWithIdentity("WORKING", "X", "WP-9", null, skewStart, "pod-new"))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.desired").value("RUN"));

    assertThat(slotKeysOf(agent)).containsExactly("X");
    assertThat(slotState("X")).isEqualTo("WORKING");
    assertThat(settingOf(agent).get(AGENT_RUNTIME_SETTING.OBSERVED_POD_UID)).isEqualTo("pod-new");
    assertThat(settingOf(agent).get(AGENT_RUNTIME_SETTING.PREVIOUS_POD_UID)).isNull();
    // 시계 이상으로 걸러진 값은 기준·시각으로 오르지 않는다(acceptedPodStart 가 없는 것처럼 다룬 자리) — 애초에 시각이 없는 보고와 다르게,
    // 정체는 이번 보고가 스스로 밝혀 저장됐다.
    assertThat(settingOf(agent).get(AGENT_RUNTIME_SETTING.REPORTED_POD_STARTED_AT)).isNull();
    assertThat(settingOf(agent).get(AGENT_RUNTIME_SETTING.STARTED_AT)).isNull();

    // 이후 같은 podUid 보고(정체 일치)가 그대로 이어진다 — 정상 시각이면 기준도 그 값으로 갱신된다.
    report(key, slotReportWithIdentity("IDLE", "X", null, null, POD_NEW, "pod-new"))
        .andExpect(status().isOk());
    assertThat(slotState("X")).isEqualTo("IDLE");
    assertThat(settingOf(agent).get(AGENT_RUNTIME_SETTING.REPORTED_POD_STARTED_AT).toInstant())
        .isEqualTo(POD_NEW.toInstant());
  }

  /**
   * 기준(시각) 없이 밝힌 정체는 관찰이 시각을 밝힐 때까지 다른 정체에 갈아끼워지지 않는다(WP-2026 리뷰 반려 ①) — 시계 이상 첫 ADOPT 는 기준을 세우지 못해
   * {@code isOlderPod} 가 판정하지 못한다. 그래서 그 동안 정상 시각의 다른 정체는 ADOPT 로 받지 않고(거절), 앞서 밝힌 살아 있는 Pod 의 보고는
   * 그대로 저장된다 — 앞서 밝힌 정체가 previous 로 박혀 영구 교착(상태 미저장·칸 409)에 빠지지 않게. 관찰(약 60초)이 시각을 밝히거나 같은 정체의 정상
   * 시각 보고가 기준을 채우면 일반 규칙으로 돌아간다.
   */
  @Test
  void status_기준_없이_밝힌_정체는_정상_시각의_다른_정체에_갈아끼워지지_않는다() throws Exception {
    // 1) 시계 이상 첫 보고로 정체를 밝힌다 — 기준(시각)은 그대로 비어 있다.
    OffsetDateTime skewStart = OffsetDateTime.now().plusSeconds(40);
    report(key, slotReportWithIdentity("WORKING", "X", "WP-9", null, skewStart, "pod-new"))
        .andExpect(status().isOk());
    assertThat(settingOf(agent).get(AGENT_RUNTIME_SETTING.OBSERVED_POD_UID)).isEqualTo("pod-new");
    assertThat(settingOf(agent).get(AGENT_RUNTIME_SETTING.REPORTED_POD_STARTED_AT)).isNull();

    // 2) 정상 시각의 다른 정체 보고 — 기준이 없어 시각으로 견볼 수 없으므로 ADOPT 로 받지 않고 거절한다(정체는 그대로).
    report(key, slotReportWithIdentity("IDLE", "X", null, null, POD_NEW, "pod-old"))
        .andExpect(status().isOk());
    assertThat(settingOf(agent).get(AGENT_RUNTIME_SETTING.OBSERVED_POD_UID)).isEqualTo("pod-new");
    assertThat(settingOf(agent).get(AGENT_RUNTIME_SETTING.PREVIOUS_POD_UID)).isNull();
    assertThat(settingOf(agent).get(AGENT_RUNTIME_SETTING.REPORTED_POD_STARTED_AT)).isNull();
    // 거절된 보고는 칸·합친 상태도 건드리지 않는다 — 살아 있는 Pod 의 값이 그대로다.
    assertThat(slotState("X")).isEqualTo("WORKING");
    assertThat(settingOf(agent).get(AGENT_RUNTIME_SETTING.AGENT_STATE)).isEqualTo("WORKING");

    // 3) 살아 있는 Pod(pod-new)의 보고는 계속 저장된다 — 정체가 previous 로 박히지 않았음을 함께 고정한다. (실제 Pod 은 시작 시각을 바꾸지
    // 않으니 같은 skewStart 가 시계 차이 여유(30초)가 지난 뒤 acceptedPodStart 를 통과해 기준을 채운다 — 여기서는 「기준이 채워지면 굳힘이
    // 풀린다」는 자리만 고정하기 위해 정상 시각을 쓴다.)
    report(key, slotReportWithIdentity("IDLE", "X", null, null, POD_NEW, "pod-new"))
        .andExpect(status().isOk());
    assertThat(slotState("X")).isEqualTo("IDLE");
    assertThat(settingOf(agent).get(AGENT_RUNTIME_SETTING.AGENT_STATE)).isEqualTo("IDLE");
    assertThat(settingOf(agent).get(AGENT_RUNTIME_SETTING.OBSERVED_POD_UID)).isEqualTo("pod-new");
    // 정상 시각 보고가 기준을 채우면 이 굳힘은 풀린다 — 관찰 없이도 일반 규칙으로 돌아온다.
    assertThat(settingOf(agent).get(AGENT_RUNTIME_SETTING.REPORTED_POD_STARTED_AT).toInstant())
        .isEqualTo(POD_NEW.toInstant());
  }

  /**
   * 시각 없는 관찰 정체 자리의 정상 시각 다른 정체는 저장한다(WP-2026 리뷰 반려 ②) — 굳힘(barBasislessAdopt)이 「관찰 정체 있음 + 시각 없음」
   * 전체에 걸면 관찰이 정체만 밝히고 시각은 못 밝힌 자리에서 새 Pod 의 정상 시각 보고가 영영 ADOPT 되지 않아 기존 동작이 깨진다. 표시({@code
   * basisless_pod_uid})가 있는 자리에만 막아 두 자리를 갈라 둔다 — 그 표시는 기준 없이 ADOPT 로만 밝힌 정체에 남는다.
   */
  @Test
  void status_시각_없는_관찰_정체_자리의_정상_시각_다른_정체는_저장한다() throws Exception {
    // 관찰이 정체만 밝힌 자리 — 시작·기준 시각은 그대로 비어 있고 표시도 없다.
    setObservedPod("pod-b", null);
    setStartedAt(null);

    // 정상 시각의 다른 정체 보고 — 굳힘에 걸리지 않고 지금 Pod 로 받아 저장한다(기존 동작 유지, 반려 ②).
    report(key, slotReportWithIdentity("WORKING", "X", "WP-9", null, POD_NEW, "pod-a"))
        .andExpect(status().isOk());

    assertThat(slotKeysOf(agent)).containsExactly("X");
    assertThat(slotState("X")).isEqualTo("WORKING");
    assertThat(settingOf(agent).get(AGENT_RUNTIME_SETTING.OBSERVED_POD_UID)).isEqualTo("pod-a");
    assertThat(settingOf(agent).get(AGENT_RUNTIME_SETTING.PREVIOUS_POD_UID)).isEqualTo("pod-b");
    assertThat(settingOf(agent).get(AGENT_RUNTIME_SETTING.REPORTED_POD_STARTED_AT).toInstant())
        .isEqualTo(POD_NEW.toInstant());
    // 기준(시각)이 함께 간 ADOPT 라 표시는 남지 않는다 — 굳힘은 다음 보고에서도 다시 걸리지 않는다.
    assertThat(settingOf(agent).get(AGENT_RUNTIME_SETTING.BASISLESS_POD_UID)).isNull();
  }

  /**
   * 표시가 선 뒤에 오는 정체 없는 관찰이 시각을 되살려도 옛 Pod 의 늦은 보고는 정체를 갈아끼우지 못한다(WP-2026 리뷰 반려 ①의 다른 순서 — 관찰이 ADOPT
   * 보다 뒤에 오는 경우) — 시계 이상 첫 ADOPT 로 표시만 남긴 자리에 구 runner 관찰(정체 없음·시각만)이 와 {@code started_at} 을 되살리면,
   * 굳힘의 문을 {@code started_at} 이 아니라 보고 기준({@code reported_pod_started_at})으로 잡지 않았다면 풀려 옛 Pod 가 정체를
   * 되돌려 영구 교착(상태 미저장·칸 409)이 된다.
   */
  @Test
  void status_표시_선_뒤_정체_없는_관찰이_시각을_되살려도_늦은_정체_보고는_거절한다() throws Exception {
    // 1) 빈 자리에서 시계 이상 첫 보고로 정체만 밝힌다 — 표시가 남고 기준(started_at·reported)은 비어 있다.
    OffsetDateTime skewStart = OffsetDateTime.now().plusSeconds(40);
    report(key, slotReportWithIdentity("WORKING", "X", "WP-9", null, skewStart, "pod-b"))
        .andExpect(status().isOk());
    assertThat(settingOf(agent).get(AGENT_RUNTIME_SETTING.OBSERVED_POD_UID)).isEqualTo("pod-b");
    assertThat(settingOf(agent).get(AGENT_RUNTIME_SETTING.BASISLESS_POD_UID)).isEqualTo("pod-b");
    assertThat(settingOf(agent).get(AGENT_RUNTIME_SETTING.STARTED_AT)).isNull();
    assertThat(settingOf(agent).get(AGENT_RUNTIME_SETTING.REPORTED_POD_STARTED_AT)).isNull();
    assertThat(slotState("X")).isEqualTo("WORKING");

    // 2) 정체 없이(구 runner) 시각만 실은 관찰이 뒤에 온다 — started_at 을 되살리지만 보고 기준은 그대로 비어 있고 표시도 남아 있다.
    observe(null, POD_OLD, "RUNNING");
    assertThat(settingOf(agent).get(AGENT_RUNTIME_SETTING.STARTED_AT).toInstant())
        .isEqualTo(POD_OLD.toInstant());
    assertThat(settingOf(agent).get(AGENT_RUNTIME_SETTING.OBSERVED_POD_UID)).isEqualTo("pod-b");
    assertThat(settingOf(agent).get(AGENT_RUNTIME_SETTING.REPORTED_POD_STARTED_AT)).isNull();
    assertThat(settingOf(agent).get(AGENT_RUNTIME_SETTING.BASISLESS_POD_UID)).isEqualTo("pod-b");

    // 3) 그 관찰과 같은 시각을 실은 옛 Pod(pod-a)의 늦은 보고 — 시각으로는 견볼 수 없어(같은 값이라 C1 이 안 잡는다) ADOPT 로 갔을 텐데,
    //    보고 기준이 아직 비어 있어 표시가 선 동안 거절한다. 칸(첫 보고의 WORKING)도 정체도 그대로다.
    report(key, slotReportWithIdentity("IDLE", "X", null, null, POD_OLD, "pod-a"))
        .andExpect(status().isOk());
    assertThat(slotState("X")).isEqualTo("WORKING");
    assertThat(settingOf(agent).get(AGENT_RUNTIME_SETTING.OBSERVED_POD_UID)).isEqualTo("pod-b");
    assertThat(settingOf(agent).get(AGENT_RUNTIME_SETTING.PREVIOUS_POD_UID)).isNull();
    assertThat(settingOf(agent).get(AGENT_RUNTIME_SETTING.BASISLESS_POD_UID)).isEqualTo("pod-b");
  }

  /**
   * 표시 잠금은 <b>서버 시각 60초 창</b> 안에서만 다른 정체의 ADOPT 를 막는다(WP-2026 3차 반려 ①) — 표시 정체가 기준을 채우는 사건 하나에만 걸어
   * 두면 그 사건이 오지 않는 상태가 매번 새 교착이 됐다(시계가 계속 앞선 노드 → 정상 노드 새 Pod 로 교체해도 영구 409). 창은 노드 시계가 아니라 표시를 남긴
   * 서버 시각으로 잰다 — 이 이슈 자체가 노드 시계 앞섬이라 그렇게 재면 같은 구멍이 난다.
   */
  @Test
  void status_표시_잠금은_서버_시각_60초_창에서만_막는다() throws Exception {
    // 1) 빈 자리에서 시계 이상 첫 보고 — 정체만 밝히고 표시와 표시 시각(서버)을 남긴다.
    OffsetDateTime skewStart = OffsetDateTime.now().plusSeconds(40);
    report(key, slotReportWithIdentity("WORKING", "X", "WP-9", null, skewStart, "pod-b"))
        .andExpect(status().isOk());
    assertThat(settingOf(agent).get(AGENT_RUNTIME_SETTING.BASISLESS_POD_UID)).isEqualTo("pod-b");
    OffsetDateTime marked = settingOf(agent).get(AGENT_RUNTIME_SETTING.BASISLESS_MARKED_AT);
    assertThat(marked).isNotNull();

    // 2) 창 안(55초 — HTTP 처리 지연까지 5초 여유) — 정상 노드의 새 Pod(pod-a) 보고도 정체를 갈아끼우지 못한다(거절, 칸·정체는 그대로).
    setBasislessMarkedAt(OffsetDateTime.now().minusSeconds(55));
    report(key, slotReportWithIdentity("IDLE", "X", null, null, POD_NEW, "pod-a"))
        .andExpect(status().isOk());
    assertThat(settingOf(agent).get(AGENT_RUNTIME_SETTING.OBSERVED_POD_UID)).isEqualTo("pod-b");
    assertThat(settingOf(agent).get(AGENT_RUNTIME_SETTING.BASISLESS_POD_UID)).isEqualTo("pod-b");

    // 3) 창 밖(61초) — ADOPT 로 받아 정체를 갈아끼우고 표시·표시 시각을 지운다(영구 교착 없음).
    setBasislessMarkedAt(OffsetDateTime.now().minusSeconds(61));
    report(key, slotReportWithIdentity("IDLE", "X", null, null, POD_NEW, "pod-a"))
        .andExpect(status().isOk());
    assertThat(settingOf(agent).get(AGENT_RUNTIME_SETTING.OBSERVED_POD_UID)).isEqualTo("pod-a");
    assertThat(settingOf(agent).get(AGENT_RUNTIME_SETTING.BASISLESS_POD_UID)).isNull();
    assertThat(settingOf(agent).get(AGENT_RUNTIME_SETTING.BASISLESS_MARKED_AT)).isNull();
    assertThat(settingOf(agent).get(AGENT_RUNTIME_SETTING.BASISLESS_POD_STARTED_RAW)).isNull();
  }

  /**
   * 기준을 채우는 모든 곳에서 표시를 함께 지운다(WP-2026 3차 반려 ②) — 표시가 시각 있는 ADOPT 로만 지워지면, MATCH 가 기준을 채운 뒤 관찰이 기준을
   * 비웠을 때 낡은 표시가 새 Pod 의 정상 ADOPT 를 다시 막는다(검토자가 3차 반려 ②로 막은 두 번째 교착).
   */
  @Test
  void status_MATCH가_기준을_채우면_표시가_지워져_관찰이_기준을_비워도_새_Pod는_ADOPT된다() throws Exception {
    // 1) 시계 이상 첫 보고로 표시만 남긴다.
    OffsetDateTime skewStart = OffsetDateTime.now().plusSeconds(40);
    report(key, slotReportWithIdentity("WORKING", "X", "WP-9", null, skewStart, "pod-b"))
        .andExpect(status().isOk());
    assertThat(settingOf(agent).get(AGENT_RUNTIME_SETTING.BASISLESS_POD_UID)).isEqualTo("pod-b");

    // 2) 표시 정체 자신(pod-b)의 정상 시각 보고는 MATCH 로 이어져 보고 기준을 채우고 표시·표시 시각을 지운다.
    report(key, slotReportWithIdentity("IDLE", "X", null, null, POD_NEW, "pod-b"))
        .andExpect(status().isOk());
    assertThat(settingOf(agent).get(AGENT_RUNTIME_SETTING.REPORTED_POD_STARTED_AT)).isNotNull();
    assertThat(settingOf(agent).get(AGENT_RUNTIME_SETTING.BASISLESS_POD_UID)).isNull();
    assertThat(settingOf(agent).get(AGENT_RUNTIME_SETTING.BASISLESS_MARKED_AT)).isNull();
    assertThat(settingOf(agent).get(AGENT_RUNTIME_SETTING.BASISLESS_POD_STARTED_RAW)).isNull();

    // 3) 뒤에 온 관찰이 더 늦은 시작을 비춰 보고 기준을 비워도 — 표시가 이미 없어 새로운 정체(pod-a)의 정상 시각 보고를 막지 않는다.
    observe(null, POD_NEW.plusSeconds(120), "RUNNING");
    assertThat(settingOf(agent).get(AGENT_RUNTIME_SETTING.REPORTED_POD_STARTED_AT)).isNull();
    report(key, slotReportWithIdentity("IDLE", "X", null, null, POD_NEW.plusSeconds(180), "pod-a"))
        .andExpect(status().isOk());
    assertThat(settingOf(agent).get(AGENT_RUNTIME_SETTING.OBSERVED_POD_UID)).isEqualTo("pod-a");
  }

  /**
   * 기준 없는 ADOPT 뒤에도 <b>이른 Pod 거절(C1)은 유지</b>된다(WP-2026 3차 반려 ③) — 기준 없는 ADOPT 가 관찰한 {@code
   * started_at} 까지 비우면 이른 Pod 거절이 꺼지고 다음 관찰이 새 Pod 로 판정해 {@code agent_*} 칸을 비운다. 보고 기준({@code
   * reported_pod_started_at})만 비우고 관찰 시각은 그대로 둔다. 표시 잠금의 창은 넘겨 둬(C1 만 남게) 시각 규칙이 실제로 서는지 본다.
   */
  @Test
  void status_기준_없는_ADOPT_뒤에도_이른_Pod_거절은_유지된다() throws Exception {
    // 1) 구 runner 관찰이 옛 Pod 시작만 남긴 자리(정체는 모른다).
    OffsetDateTime normalStart = OffsetDateTime.now().minusMinutes(10).withNano(0);
    setObservedPod(null, null);
    setStartedAt(normalStart);

    // 2) 시계 이상 첫 보고로 정체만 밝힌다 — 관찰 시각(normalStart)은 그대로 두고 보고 기준만 비운다(3차 반려 ③).
    OffsetDateTime skewStart = OffsetDateTime.now().plusSeconds(40);
    report(key, slotReportWithIdentity("WORKING", "X", "WP-9", null, skewStart, "pod-b"))
        .andExpect(status().isOk());
    assertThat(settingOf(agent).get(AGENT_RUNTIME_SETTING.BASISLESS_POD_UID)).isEqualTo("pod-b");
    assertThat(settingOf(agent).get(AGENT_RUNTIME_SETTING.STARTED_AT).toInstant())
        .isEqualTo(normalStart.toInstant());
    assertThat(settingOf(agent).get(AGENT_RUNTIME_SETTING.REPORTED_POD_STARTED_AT)).isNull();

    // 3) 표시 잠금의 창은 넘겨 둔다(61초) — 이제 막는 것은 위 C1(관찰 시각)뿐이다. 두 세대 넘게 이른 옛 Pod(pod-a)의 늦은 보고는
    //    관찰 시각이 그대로라 여전히 거절된다. 시각까지 비웠다면 current 가 비어 C1 이 서지 못해 ADOPT 로 받아 정체가 갈아끼워졌을 것이다.
    setBasislessMarkedAt(OffsetDateTime.now().minusSeconds(61));
    OffsetDateTime earlyStart = normalStart.minusMinutes(5);
    report(key, slotReportWithIdentity("IDLE", "X", null, null, earlyStart, "pod-a"))
        .andExpect(status().isOk());
    assertThat(settingOf(agent).get(AGENT_RUNTIME_SETTING.OBSERVED_POD_UID)).isEqualTo("pod-b");
    assertThat(settingOf(agent).get(AGENT_RUNTIME_SETTING.STARTED_AT).toInstant())
        .isEqualTo(normalStart.toInstant());
    assertThat(slotState("X")).isEqualTo("WORKING");
  }

  /**
   * 시계 이상으로 걸러진 시각의 첫 보고라도 낮은 generation 은 정체를 ADOPT 하지 않는다(WP-2026) — 정체 미확정 + 시계 이상으로 ADOPT 가
   * 허용돼도 그 뒤의 {@code barStaleAdopt} 가 낮은 generation 보고를 막아(5차 반려 ④) 앞 세대 Pod 가 정체를 못 박지 않는다. 시계 이상
   * 플래그가 세대 판정까지 통과시키지 않음을 함께 고정한다.
   */
  @Test
  void status_시계_이상_첫_보고도_낮은_generation_은_거절한다() throws Exception {
    long gen = settingOf(agent).get(AGENT_RUNTIME_SETTING.GENERATION);
    // 정체 미확정(모든 정체·시각 칸이 비어 있는 상태)에서 시계 이상으로 걸러지는 미래 시각 + 정체의 첫 보고를
    // 낮은 generation 로 보낸다 — podIdentity 에서는 ADOPT, barStaleAdopt 에서는 OTHER 로 바뀌어야 한다.
    OffsetDateTime skewStart = OffsetDateTime.now().plusSeconds(40);

    report(key, slotReportWithIdentity("WORKING", "X", "WP-9", gen - 1, skewStart, "pod-new"))
        .andExpect(status().isOk());

    // 저장은 하나도 되지 않는다 — 칸·합친 상태·정체·기준이 그대로 비어 있다.
    assertThat(slotKeysOf(agent)).isEmpty();
    assertThat(settingOf(agent).get(AGENT_RUNTIME_SETTING.AGENT_STATE)).isNull();
    assertThat(settingOf(agent).get(AGENT_RUNTIME_SETTING.OBSERVED_POD_UID)).isNull();
    assertThat(settingOf(agent).get(AGENT_RUNTIME_SETTING.PREVIOUS_POD_UID)).isNull();
    assertThat(settingOf(agent).get(AGENT_RUNTIME_SETTING.REPORTED_POD_STARTED_AT)).isNull();
    assertThat(settingOf(agent).get(AGENT_RUNTIME_SETTING.STARTED_AT)).isNull();
  }

  /**
   * 관찰 정체가 이미 있는 상태의 시계 이상 다른 정체 보고는 저장 없이 거절한다(WP-2026) — 시계 이상 걸러짐의 ADOPT 는 정체 미확정일 때만 허용이라, 정체를
   * 아는 구간에서는 6차 반려 ① 교착(정체가 과거로 되돌아 살아 있는 Pod 가 영구 OTHER)이 되살아나지 않는다(5차 반려 ② · 6차 반려 ① 유지).
   */
  @Test
  void status_관찰_정체가_있는_상태의_시계_이상_다른_정체_보고는_저장하지_않는다() throws Exception {
    setObservedPod("pod-b", POD_NEW);
    OffsetDateTime skewStart = OffsetDateTime.now().plusSeconds(40);

    // 응답 값은 채택/거절 어느 쪽이든 RUN — 판별은 아래 저장 단언이 한다.
    report(key, slotReportWithIdentity("WORKING", "X", "WP-9", null, skewStart, "pod-a"))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.desired").value("RUN"));

    // 칸·합친 상태·정체·기준 어느 것도 쓰지 않고 저장된 행 기준 응답이다.
    assertThat(slotKeysOf(agent)).isEmpty();
    assertThat(settingOf(agent).get(AGENT_RUNTIME_SETTING.AGENT_STATE)).isNull();
    assertThat(settingOf(agent).get(AGENT_RUNTIME_SETTING.OBSERVED_POD_UID)).isEqualTo("pod-b");
    assertThat(settingOf(agent).get(AGENT_RUNTIME_SETTING.REPORTED_POD_STARTED_AT).toInstant())
        .isEqualTo(POD_NEW.toInstant());
  }

  /**
   * 애초에 시작 시각이 없는 모르는 정체의 상태 보고는 저장하지 않고 저장된 행 기준 응답을 준다(WP-1968 2차 반려 ②) — 시각 없이 ADOPT 되면 그 인식이 기준
   * 없이 박히고, 그 뒤 옛 Pod 가 시각을 실어 다시 ADOPT 하면 정체가 과거로 되돌아 살아 있는 Pod 가 영구 OTHER 로 남는다(6차 반려 ①). 시계 이상으로
   * 걸러진 시각의 보고는 정체 미확정일 때만 ADOPT 로 받아 갈라 두었으므로(WP-2026) 그 경우는 위 {@code
   * status_시계_이상으로_걸러진_시각의_첫_보고는_정체를_받는다} 테스트가 따로 다룬다. 관찰(약 60초)이 정체를 밝힌 뒤 다시 오면 MATCH 로 저장된다.
   */
  @Test
  void status_시각_없는_모르는_정체는_저장하지_않는다() throws Exception {
    setObservedPod("pod-a", POD_NEW);
    setRow(agent, null, "IDLE", "RUN");

    report(key, slotReportWithIdentity("WORKING", "X", "WP-9", null, null, "pod-new"))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.desired").value("RUN"));

    assertThat(slotKeysOf(agent)).isEmpty();
    assertThat(settingOf(agent).get(AGENT_RUNTIME_SETTING.AGENT_STATE)).isNull();
    assertThat(settingOf(agent).get(AGENT_RUNTIME_SETTING.OBSERVED_POD_UID)).isEqualTo("pod-a");
    assertThat(settingOf(agent).get(AGENT_RUNTIME_SETTING.REPORTED_POD_STARTED_AT).toInstant())
        .isEqualTo(POD_NEW.toInstant());
  }

  /**
   * 낮은 generation 보고는 정체를 ADOPT 하지 않는다(WP-1968 5차 반려 ④) — 몇 초만 살았던 옛 Pod(B)의 늦은 보고가 정체를 되돌리면
   * (observed=B·previous=C) 살아 있는 지금 Pod(C)가 영원히 previous 로 남아 이 뒤의 상태 보고가 계속 무시된다. ADOPT 대신 저장 없이
   * 버리고 정체는 그대로다.
   */
  @Test
  void status_낮은_generation_보고는_정체를_ADOPT_하지_않는다() throws Exception {
    long gen = settingOf(agent).get(AGENT_RUNTIME_SETTING.GENERATION);
    setObservedPod("pod-c", POD_NEW);

    report(key, slotReportWithIdentity("WORKING", "X", "WP-9", gen - 1, POD_NEW, "pod-b"))
        .andExpect(status().isOk());

    assertThat(slotKeysOf(agent)).isEmpty();
    assertThat(settingOf(agent).get(AGENT_RUNTIME_SETTING.AGENT_STATE)).isNull();
    assertThat(settingOf(agent).get(AGENT_RUNTIME_SETTING.OBSERVED_POD_UID)).isEqualTo("pod-c");
    assertThat(settingOf(agent).get(AGENT_RUNTIME_SETTING.REPORTED_POD_STARTED_AT).toInstant())
        .isEqualTo(POD_NEW.toInstant());
  }

  /**
   * 기준 없이 밝힌 정체 자리에서 Pod 가 다시 뜨면(시계 이상 다른 정체) 저장으로 회복한다(WP-2032) — 옛 runner 는 관찰에 podUid 를 싣지 않아 관찰
   * 회복 경로가 없어, 이 자리에서는 새 Pod 의 보고가 영구 OTHER 로 남았다. 표시 잠금(서버 시각 60초) 안에서는 근거가 있어도 막고(2단계), 지난 뒤에는
   * <b>표시를 남긴 그 보고의 걸리기 전 시작(같은 노드 시계)보다 늦을 때</b>만 정체를 갈아끼운다(4단계) — 6차 반려 ① 교착 방지 유지. 근거 없는 죽은 옛
   * Pod 늦은 보고는 잠금이 지난 뒤에도 거절된다(3단계, WP-2032 리뷰 반려 ①).
   *
   * <p>값은 <b>노드 시계가 5분 빠른 상황</b>의 현실 값이다 — 시작 시각은 k8s 관찰값이라 과거이고(pod-b 는 10초 전), 보고에 실린 Pod
   * 시작(raw)만 노드 시계 때문에 미래다. 앞 리뷰는 시작 시각을 미래(now+60)로 두어 회복 근거 검사가 망가져도 테스트가 통과하는 문제를 잡았다(2차 반려 ②).
   */
  @Test
  void status_기준_없이_밝힌_정체_자리의_재시작_보고는_저장한다() throws Exception {
    OffsetDateTime now = OffsetDateTime.now().withNano(0); // DB 는 마이크로초 저장(timestamp(6))
    // 노드 시계가 5분 빠르다 — raw 는 실제 시작 시각 + 300초.
    OffsetDateTime markRaw = now.plusSeconds(290); // pod-b: 실제 10초 전 시작
    OffsetDateTime oldPodRaw = now.plusSeconds(230); // pod-old: 실제 70초 전 시작(표시보다 옛 Pod)
    OffsetDateTime newPodRaw = now.plusSeconds(300); // pod-c: 실제 방금 시작

    // 1) 시계 이상 첫 보고로 정체를 밝힌다 — 기준(시각)은 비어 있고 표시와 그 보고의 걸리기 전 시작만 남는다(WP-2026·WP-2032 리뷰 반려 ①).
    report(key, slotReportWithIdentity("WORKING", "X", "WP-9", null, markRaw, "pod-b"))
        .andExpect(status().isOk());
    assertThat(settingOf(agent).get(AGENT_RUNTIME_SETTING.OBSERVED_POD_UID)).isEqualTo("pod-b");
    assertThat(settingOf(agent).get(AGENT_RUNTIME_SETTING.BASISLESS_POD_UID)).isEqualTo("pod-b");
    assertThat(settingOf(agent).get(AGENT_RUNTIME_SETTING.REPORTED_POD_STARTED_AT)).isNull();
    assertThat(settingOf(agent).get(AGENT_RUNTIME_SETTING.BASISLESS_POD_STARTED_RAW).toInstant())
        .isEqualTo(markRaw.toInstant());

    // 표시 잠금 창을 시각으로 고정한다 — 1번~2번 사이가 실수로 60초를 넘겨도 잠금이 풀리지 않게.
    setBasislessMarkedAt(now.minusSeconds(55));

    // 2) 표시 잠금(60초) 안의 재시작 보고 — 근거가 있어도 정체를 갈아끼우지 않는다(barBasislessAdopt 가 막는다 — 기존 방어 유지).
    //    관찰한 시작(started_at)은 아직 없다 — 잠금 조건 (b) 가 서지 않아 (a) 창으로만 막힌다.
    report(key, slotReportWithIdentity("IDLE", "X", null, null, newPodRaw, "pod-c"))
        .andExpect(status().isOk());
    assertThat(settingOf(agent).get(AGENT_RUNTIME_SETTING.OBSERVED_POD_UID)).isEqualTo("pod-b");
    assertThat(slotState("X")).isEqualTo("WORKING");

    // runner 가 지금 Pod 시작을 관찰해 둔 자리 — k8s 관찰값이라 과거다(노드 시계 raw 와 다른 기준).
    setStartedAt(now.minusSeconds(10));
    // 표시 잠금 지난 뒤.
    setBasislessMarkedAt(OffsetDateTime.now().minusSeconds(61));

    // 3) 표시 잠금이 지난 뒤의 죽은 옛 Pod 늦은 보고 — 표시를 남긴 보고의 걸리기 전 시작(290초)보다 이르므로 근거가 없어 회복하지 않는다
    // (WP-2032 리뷰 반려 ①). 관찰한 시작이 과거(now-10)라 옛 검사(걸리기 전 raw ≥ 지금 시작)라면 늘 참이어서 정체를 가져갔을 값이다 —
    // 정체를 가져가면 살아 있는 Pod 가 previous 로 박혀 영구 OTHER/409 가 된다.
    report(key, slotReportWithIdentity("IDLE", "X", null, null, oldPodRaw, "pod-old"))
        .andExpect(status().isOk());
    assertThat(settingOf(agent).get(AGENT_RUNTIME_SETTING.OBSERVED_POD_UID)).isEqualTo("pod-b");
    assertThat(slotState("X")).isEqualTo("WORKING");

    // 관찰이 아직 Pod 시작을 못 비친 상태(기준 없는 자리는 reported 가 늘 비어 있다) — 시작을 몰라도 같은 시계 근거로 거절이 이어진다(지적 ③).
    setStartedAt(null);

    // 4) 표시 잠금이 지난 뒤의 재시작 보고 — 표시 근거(290초)보다 늦어 회복하고, 저장으로 정체를 갈아끼운다(WP-2032).
    report(key, slotReportWithIdentity("IDLE", "X", null, null, newPodRaw, "pod-c"))
        .andExpect(status().isOk());
    assertThat(slotKeysOf(agent)).containsExactly("X");
    assertThat(slotState("X")).isEqualTo("IDLE");
    assertThat(settingOf(agent).get(AGENT_RUNTIME_SETTING.OBSERVED_POD_UID)).isEqualTo("pod-c");
    assertThat(settingOf(agent).get(AGENT_RUNTIME_SETTING.PREVIOUS_POD_UID)).isEqualTo("pod-b");
    // 회복 ADOPT 도 표시를 다시 남기므로(adoptPodIdentity), 그 뒤 보고는 다시 60초 표시 잠금에 걸린다(WP-2032) — 근거도 새 값으로
    // 갱신된다.
    assertThat(settingOf(agent).get(AGENT_RUNTIME_SETTING.BASISLESS_POD_UID)).isEqualTo("pod-c");
    assertThat(settingOf(agent).get(AGENT_RUNTIME_SETTING.BASISLESS_MARKED_AT)).isNotNull();
    assertThat(settingOf(agent).get(AGENT_RUNTIME_SETTING.BASISLESS_POD_STARTED_RAW).toInstant())
        .isEqualTo(newPodRaw.toInstant());
    // 회복은 정체만 갈아끼울 뿐 기준(시각)은 그대로 비어 있다.
    assertThat(settingOf(agent).get(AGENT_RUNTIME_SETTING.REPORTED_POD_STARTED_AT)).isNull();

    // 5) 갱신된 근거로 다시 — 갈아끼운 뒤엔 표시 근거(300초)보다 이른 옛 Pod 보고는 그대로 거절된다.
    setBasislessMarkedAt(OffsetDateTime.now().minusSeconds(61));
    report(key, slotReportWithIdentity("IDLE", "X", null, null, oldPodRaw, "pod-old"))
        .andExpect(status().isOk());
    assertThat(settingOf(agent).get(AGENT_RUNTIME_SETTING.OBSERVED_POD_UID)).isEqualTo("pod-c");
    assertThat(slotState("X")).isEqualTo("IDLE");
  }
}
