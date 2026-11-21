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
import com.workplace.agentruntime.outbound.AgentRuntimeChangeNotifier;
import com.workplace.agentruntime.outbound.AgentRuntimeDesiredChanged;
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
    return slotReportBody(state, slot, issueKey, generation, nextCheckAt, null);
  }

  /**
   * 칸 보고 본문(보고한 Pod 시작 시각 포함) — 서버가 끝나는 중인 옛 Pod 의 늦은 보고를 지금 Pod 의 보고와 갈라 보는 데 쓴다(WP-1913 리뷰 반려 ①).
   */
  private String slotReportWithPod(
      String state, String slot, String issueKey, Long generation, OffsetDateTime podStartedAt)
      throws Exception {
    return slotReportBody(state, slot, issueKey, generation, null, podStartedAt);
  }

  /** 칸 보고 본문 — null 인 값은 싣지 않는다. 선택 값(다음 확인 시각·Pod 시작 시각)은 한 군데서만 쌓아 본문이 어긋나지 않게 한다. */
  private String slotReportBody(
      String state,
      String slot,
      String issueKey,
      Long generation,
      String nextCheckAt,
      OffsetDateTime podStartedAt)
      throws Exception {
    Map<String, Object> body = new java.util.LinkedHashMap<>();
    body.put("state", state);
    if (slot != null) body.put("slot", slot);
    if (issueKey != null) body.put("issueKey", issueKey);
    if (generation != null) body.put("generation", generation);
    if (nextCheckAt != null) body.put("nextCheckAt", nextCheckAt);
    if (podStartedAt != null) body.put("podStartedAt", podStartedAt);
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
    slots.upsert(agent, "HR", AgentState.WORKING, "HR-2", null, OffsetDateTime.now().minusHours(7));

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
    OffsetDateTime startedAt = OffsetDateTime.now().minusMinutes(10);
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
}
