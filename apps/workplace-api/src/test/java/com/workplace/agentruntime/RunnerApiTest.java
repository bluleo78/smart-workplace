package com.workplace.agentruntime;

import static com.workplace.jooq.Tables.AGENT_RUNTIME_SETTING;
import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.authentication;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.request;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.workplace.agentruntime.dto.CreateAgentLocationRequest;
import com.workplace.agentruntime.dto.PutAgentRuntimeSettingRequest;
import com.workplace.agentruntime.realtime.RunnerSseRegistry;
import com.workplace.agentruntime.service.AgentLocationService;
import com.workplace.agentruntime.service.AgentRuntimeSettingService;
import com.workplace.global.security.JwtTokenProvider;
import com.workplace.global.tenant.TenantContext;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.TestFixtures;
import com.workplace.support.WebSessionAuth;
import java.util.List;
import java.util.Map;
import org.jooq.DSLContext;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.test.web.servlet.ResultActions;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;

/**
 * WP-1249 runner API 통합 테스트 — runner 토큰 인증(다른 경로·다른 인증 차단), 원하는 상태 목록(위치·테넌트 격리, applyNow 계산), 관찰
 * 보고(다른 위치 무시), 변경 스트림(자기 위치만).
 *
 * <p>위치 2개(L1 기본·L2)와 AI 3명(A1 L1 켜짐, A2 L2 켜짐, A3 L1 꺼짐). 테스트 트랜잭션 안이라 RLS GUC 는 테스트가 정한 값이 그대로
 * 쓰인다 — 그래서 runner 호출 전마다 토큰의 테넌트로 {@code useTenant} 를 맞춘다(실제 요청에서는 필터가 토큰의 테넌트로 세운다).
 */
@Transactional
class RunnerApiTest extends IntegrationTestBase {

  private static final String BASE = "/api/v1/agent-runtime/runner";

  @Autowired MockMvc mvc;
  @Autowired ObjectMapper om;
  @Autowired DSLContext dsl;
  @Autowired AgentLocationService locationService;
  @Autowired AgentRuntimeSettingService settingService;
  @Autowired RunnerSseRegistry sseRegistry;
  @Autowired JwtTokenProvider jwtTokenProvider;

  private long admin;
  private AgentRuntimeTestFixtures fx;
  private long l1;
  private long l2;
  private String t1;
  private String t2;
  private long a1;
  private long a2;
  private long a3;

  @BeforeEach
  void seed() {
    TenantContext.set(1L);
    admin = TestFixtures.activeMemberOfCurrentTenant(dsl, TestFixtures.createHuman(dsl));
    TestFixtures.grantRole(dsl, admin, "ADMIN");
    fx = new AgentRuntimeTestFixtures(dsl, om, settingService, admin);
    var first = locationService.create(admin, new CreateAgentLocationRequest("L1", null, 5));
    l1 = first.location().id();
    t1 = first.plaintextToken();
    l2 =
        locationService
            .create(admin, new CreateAgentLocationRequest("L2", null, 5))
            .location()
            .id();
    // 토큰은 재발급으로 받는다 — 계획대로 rotateToken 경로도 함께 지난다.
    t2 = locationService.rotateToken(admin, l2).plaintextToken();
    a1 = fx.runningAgent(null);
    a2 = fx.runningAgent(l2);
    a3 = fx.newAgent(l1);
  }

  /** runner 토큰으로 부른다 — 호출 전에 GUC 를 토큰의 테넌트로, 호출 뒤 테스트 기본 테넌트로 되돌린다. */
  private ResultActions runner(MockHttpServletRequestBuilder b, String token, long tenantId)
      throws Exception {
    useTenant(tenantId);
    ResultActions r = mvc.perform(b.header("Authorization", "Bearer " + token));
    useTenant(1L);
    return r;
  }

  private ResultActions desired(String token) throws Exception {
    return runner(get(BASE + "/desired"), token, 1L);
  }

  private ResultActions observed(String token, String body) throws Exception {
    return runner(
        post(BASE + "/observed").contentType(MediaType.APPLICATION_JSON).content(body), token, 1L);
  }

  /** 관찰·AI 상태 칸을 직접 맞춘다(관찰 generation·AI 상태·적용 시점). */
  private void setObserved(long agent, Long observedGeneration, String agentState, String mode) {
    dsl.update(AGENT_RUNTIME_SETTING)
        .set(AGENT_RUNTIME_SETTING.OBSERVED_GENERATION, observedGeneration)
        .set(AGENT_RUNTIME_SETTING.PHASE, observedGeneration == null ? null : "RUNNING")
        .set(AGENT_RUNTIME_SETTING.AGENT_STATE, agentState)
        .set(AGENT_RUNTIME_SETTING.APPLY_MODE, mode)
        .where(AGENT_RUNTIME_SETTING.AGENT_USER_ID.eq(agent))
        .execute();
  }

  /** desired 응답에서 A1 의 applyNow. */
  private boolean applyNowOfA1() throws Exception {
    JsonNode agents = fx.json(desired(t1).andExpect(status().isOk())).get("agents");
    assertThat(agents).hasSize(1);
    return agents.get(0).get("applyNow").asBoolean();
  }

  /** L1 토큰 → 켜져 있고 실제 위치가 L1(기본 따라가기)인 A1 만. 템플릿 값·설정·비밀값 참조·조회 주기·MCP 주소가 실린다. */
  @Test
  void desired_listsOnlyRunningAgentsOfThisLocation() throws Exception {
    desired(t1)
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.locationId").value(l1))
        .andExpect(jsonPath("$.locationName").value("L1"))
        .andExpect(jsonPath("$.pollIntervalSeconds").value(300))
        .andExpect(jsonPath("$.mcpUrl").value("http://localhost:6090/mcp"))
        .andExpect(jsonPath("$.apiUrl").value("http://localhost:6060/api/v1"))
        .andExpect(jsonPath("$.agents.length()").value(1))
        .andExpect(jsonPath("$.agents[0].agentUserId").value(a1))
        .andExpect(jsonPath("$.agents[0].tenantId").value(1))
        .andExpect(jsonPath("$.agents[0].username").isNotEmpty())
        .andExpect(jsonPath("$.agents[0].generation").value(fx.generationOf(a1)))
        .andExpect(
            jsonPath("$.agents[0].image")
                .value("docker.io/iacloudops/genia-works-agent-claude-code:latest"))
        .andExpect(jsonPath("$.agents[0].resources.cpuRequest").value("2"))
        .andExpect(jsonPath("$.agents[0].sidecars[0].name").value("dind"))
        .andExpect(jsonPath("$.agents[0].plugins[0].name").value("genia-works"))
        .andExpect(jsonPath("$.agents[0].config.model").value("opus"))
        .andExpect(jsonPath("$.agents[0].secrets[?(@.name=='repos')].source").value("WORKS"))
        .andExpect(jsonPath("$.agents[0].secrets[?(@.name=='github')]").isEmpty());

    desired(t2)
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.agents.length()").value(1))
        .andExpect(jsonPath("$.agents[0].agentUserId").value(a2));
  }

  /** 쉴 때 적용인데 AI 가 일하는 중이면 지금 바꾸지 않는다. */
  @Test
  void desired_whenGenerationAheadAndApplyModeIdleAndAgentWorking_applyNowFalse() throws Exception {
    setObserved(a1, fx.generationOf(a1) - 1, "WORKING", "IDLE");
    assertThat(applyNowOfA1()).isFalse();
  }

  /** 쉴 때 적용이고 AI 가 쉬는 중이면 지금 바꾼다. */
  @Test
  void desired_whenGenerationAheadAndApplyModeIdleAndAgentIdle_applyNowTrue() throws Exception {
    setObserved(a1, fx.generationOf(a1) - 1, "IDLE", "IDLE");
    assertThat(applyNowOfA1()).isTrue();
  }

  /** 바로 적용이면 AI 가 일하는 중이어도 지금 바꾼다. */
  @Test
  void desired_whenGenerationAheadAndApplyModeNow_applyNowTrue() throws Exception {
    setObserved(a1, fx.generationOf(a1) - 1, "WORKING", "NOW");
    assertThat(applyNowOfA1()).isTrue();
  }

  /** 한 번도 뜬 적이 없으면(관찰 generation 없음) 지금 띄운다. */
  @Test
  void desired_whenGenerationAheadAndNeverObserved_applyNowTrue() throws Exception {
    setObserved(a1, null, null, "IDLE");
    assertThat(applyNowOfA1()).isTrue();
  }

  /** 이미 반영된 generation 이면 바꿀 것이 없다(바로 적용이어도). */
  @Test
  void desired_whenUpToDate_applyNowFalse() throws Exception {
    setObserved(a1, fx.generationOf(a1), "IDLE", "NOW");
    assertThat(applyNowOfA1()).isFalse();
  }

  /** 재발급으로 회수된 옛 토큰은 401. */
  @Test
  void desired_withRevokedToken_returns401() throws Exception {
    TenantContext.set(1L);
    String fresh = locationService.rotateToken(admin, l1).plaintextToken();

    desired(t1).andExpect(status().isUnauthorized());
    desired(fresh).andExpect(status().isOk());
  }

  /** 모르는 토큰·토큰 없음은 401. */
  @Test
  void desired_withUnknownOrMissingToken_returns401() throws Exception {
    desired("rt_nope").andExpect(status().isUnauthorized());
    mvc.perform(get(BASE + "/desired")).andExpect(status().isUnauthorized());
  }

  /** 다른 워크스페이스 위치의 토큰은 그 워크스페이스의 AI 만 본다 — 테넌트 1 의 AI 는 나오지 않는다. */
  @Test
  void desired_withOtherTenantToken_doesNotLeak() throws Exception {
    long tenant2 = TestFixtures.createTenant(dsl, "ACTIVE");
    useTenant(tenant2);
    long admin2 = TestFixtures.activeMemberOfCurrentTenant(dsl, TestFixtures.createHuman(dsl));
    var loc = locationService.create(admin2, new CreateAgentLocationRequest("남의 위치", null, 3));
    long other =
        TestFixtures.activeMemberOfCurrentTenant(dsl, TestFixtures.createAgentNoToken(dsl));
    settingService.put(
        admin2, other, new PutAgentRuntimeSettingRequest("claude-code", null, Map.of(), null));
    settingService.start(admin2, other);

    JsonNode body =
        fx.json(
            runner(get(BASE + "/desired"), loc.plaintextToken(), tenant2)
                .andExpect(status().isOk()));

    assertThat(body.get("locationId").asLong()).isEqualTo(loc.location().id());
    assertThat(body.get("agents")).hasSize(1);
    assertThat(body.at("/agents/0/agentUserId").asLong()).isEqualTo(other);
    assertThat(body.at("/agents/0/tenantId").asLong()).isEqualTo(tenant2);
  }

  /** runner 토큰은 runner 경로 밖에서 인증되지 않는다 — 401. */
  @Test
  void userApi_withRunnerToken_returns401() throws Exception {
    runner(get("/api/v1/users/me"), t1, 1L).andExpect(status().isUnauthorized());
  }

  /** 사람 JWT 로는 runner 경로에 닿지 않는다 — 403. */
  @Test
  void runnerApi_withUserJwt_returns403() throws Exception {
    String jwt = jwtTokenProvider.generateAccessToken(admin, "admin", 1L);
    TenantContext.set(1L);
    mvc.perform(get(BASE + "/desired").header("Authorization", "Bearer " + jwt))
        .andExpect(status().isForbidden());
    TenantContext.set(1L);
    mvc.perform(
            get(BASE + "/desired")
                .with(
                    authentication(
                        WebSessionAuth.of(
                            admin, List.of(new SimpleGrantedAuthority("user:write"))))))
        .andExpect(status().isForbidden());
  }

  /** 관찰 보고가 관찰 칸을 채워 관리자 화면의 상태·관찰 값에 보인다. generation 은 그대로. */
  @Test
  void observed_updatesObservedColumns() throws Exception {
    long g = fx.generationOf(a1);

    observed(
            t1,
            "{\"agents\":[{\"agentUserId\":"
                + a1
                + ",\"observedGeneration\":"
                + g
                + ",\"phase\":\"RUNNING\",\"cpuMillicores\":1200,\"memoryBytes\":1048576}]}")
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.updated").value(1))
        .andExpect(jsonPath("$.ignored.length()").value(0));

    TenantContext.set(1L);
    mvc.perform(
            get("/api/v1/admin/agents/" + a1 + "/runtime-setting")
                .with(
                    authentication(
                        WebSessionAuth.of(
                            admin, List.of(new SimpleGrantedAuthority("user:write"))))))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.status").value("RUNNING"))
        .andExpect(jsonPath("$.generation").value(g))
        .andExpect(jsonPath("$.observed.cpuMillicores").value(1200))
        .andExpect(jsonPath("$.observed.memoryBytes").value(1048576))
        .andExpect(jsonPath("$.observed.observedAt").isNotEmpty());
  }

  /** 꺼진 AI(desired STOP)라도 이 위치의 AI 면 정지 보고를 받는다 — 상태가 「끄는 중」에 머물지 않게. */
  @Test
  void observed_acceptsStoppedReportForStoppedAgentOfThisLocation() throws Exception {
    observed(t1, "{\"agents\":[{\"agentUserId\":" + a3 + ",\"phase\":\"STOPPED\"}]}")
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.updated").value(1));
  }

  /** 다른 위치의 AI·없는 AI 는 ignored 로 돌려주고 행을 고치지 않는다. */
  @Test
  void observed_ignoresAgentsOfOtherLocation() throws Exception {
    observed(
            t1,
            "{\"agents\":[{\"agentUserId\":"
                + a2
                + ",\"observedGeneration\":99,\"phase\":\"FAILED\"},{\"agentUserId\":999999999,\"phase\":\"RUNNING\"}]}")
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.updated").value(0))
        .andExpect(jsonPath("$.ignored[0]").value(a2))
        .andExpect(jsonPath("$.ignored[1]").value(999999999));

    var row =
        dsl.selectFrom(AGENT_RUNTIME_SETTING)
            .where(AGENT_RUNTIME_SETTING.AGENT_USER_ID.eq(a2))
            .fetchOne();
    assertThat(row.getObservedGeneration()).isNull();
    assertThat(row.getPhase()).isNull();
  }

  /** phase 는 다섯 값만 — 틀린 값은 400(DB 제약 500 이 아니라). */
  @Test
  void observed_withUnknownPhase_returns400() throws Exception {
    observed(t1, "{\"agents\":[{\"agentUserId\":" + a1 + ",\"phase\":\"EXPLODED\"}]}")
        .andExpect(status().isBadRequest());
  }

  /**
   * 변경 스트림 — 연결하면 connected 코멘트를 받고, A1 설정이 바뀌면 커밋 뒤에 L1 스트림에만 agent-runtime.changed 가 간다. 테스트
   * 트랜잭션은 커밋되지 않으므로 등록된 커밋 뒤 작업을 직접 돌린다.
   */
  @Test
  void events_receivesChangedForOwnLocationOnly() throws Exception {
    MvcResult s1 =
        runner(get(BASE + "/events"), t1, 1L).andExpect(request().asyncStarted()).andReturn();
    MvcResult s2 =
        runner(get(BASE + "/events"), t2, 1L).andExpect(request().asyncStarted()).andReturn();
    assertThat(s1.getResponse().getContentAsString()).contains(":connected");
    assertThat(sseRegistry.connectionCount(1L, l1)).isEqualTo(1);
    assertThat(sseRegistry.connectionCount(1L, l2)).isEqualTo(1);

    TenantContext.set(1L);
    settingService.stop(admin, a1);
    // 커밋 전에는 보내지 않는다.
    assertThat(s1.getResponse().getContentAsString()).doesNotContain("agent-runtime.changed");
    TransactionSynchronizationManager.getSynchronizations()
        .forEach(TransactionSynchronization::afterCommit);

    assertThat(s1.getResponse().getContentAsString())
        .contains("event:agent-runtime.changed")
        .contains("{\"locationId\":" + l1 + "}");
    assertThat(s2.getResponse().getContentAsString()).doesNotContain("agent-runtime.changed");
    sseRegistry.closeAll(1L, l1);
    sseRegistry.closeAll(1L, l2);
  }

  /**
   * WP-1280 — 관찰 보고의 metricsAvailable 을 위치에 적는다. 값이 없는 보고(일시 오류·옛 runner)는 마지막 값을 두고, 다른 위치에는 번지지
   * 않는다.
   */
  @Test
  void observed_recordsMetricsAvailableOnLocation() throws Exception {
    // 아직 보고 전 — 모름
    assertThat(locationService.get(l1).metricsAvailable()).isNull();

    observed(t1, "{\"agents\":[],\"metricsAvailable\":false}").andExpect(status().isOk());
    assertThat(locationService.get(l1).metricsAvailable()).isFalse();
    assertThat(locationService.get(l2).metricsAvailable()).isNull();

    // 값이 없는 보고는 마지막 값을 그대로 둔다
    observed(t1, "{\"agents\":[]}").andExpect(status().isOk());
    assertThat(locationService.get(l1).metricsAvailable()).isFalse();

    observed(t1, "{\"agents\":[],\"metricsAvailable\":true}").andExpect(status().isOk());
    assertThat(locationService.get(l1).metricsAvailable()).isTrue();
  }
}
