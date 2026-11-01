package com.workplace.agentruntime;

import static com.workplace.jooq.Tables.AGENT_API_KEY;
import static com.workplace.jooq.Tables.AGENT_RUNTIME_SETTING;
import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.authentication;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.workplace.agentruntime.dto.CreateAgentLocationRequest;
import com.workplace.agentruntime.dto.PutAgentRuntimeSettingRequest;
import com.workplace.agentruntime.outbound.AgentRuntimeDesiredChanged;
import com.workplace.agentruntime.service.AgentLocationService;
import com.workplace.agentruntime.service.AgentRuntimeSettingService;
import com.workplace.auth.repository.AgentApiKeyRepository;
import com.workplace.auth.service.AgentApiKeyService;
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
  @Autowired com.fasterxml.jackson.databind.ObjectMapper om;
  @Autowired AgentLocationService locationService;
  @Autowired AgentRuntimeSettingService settingService;
  @Autowired AgentApiKeyService keyService;
  @Autowired AgentApiKeyRepository keyRepo;
  @Autowired ApplicationEvents appEvents;

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

  /** 보고한 상태·이슈 키·다음 확인 시각이 관리자 화면의 관찰 상태로 보인다. 쉬는 중 보고는 이슈 키를 지운다. */
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
        .andExpect(jsonPath("$.observed.agentNextCheckAt").isNotEmpty());
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
        .andExpect(jsonPath("$.errors.code").value("AGENT_STATUS_AGENT_ONLY"));
  }

  /** 상태가 없으면 400. */
  @Test
  void status_withoutState_returns400() throws Exception {
    report(key, "{\"issueKey\":\"WD-1\"}").andExpect(status().isBadRequest());
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
