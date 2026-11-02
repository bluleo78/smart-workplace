package com.workplace.agentruntime;

import static com.workplace.jooq.Tables.USER;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.authentication;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.workplace.agentruntime.dto.CreateAgentLocationRequest;
import com.workplace.agentruntime.service.AgentLocationService;
import com.workplace.agentruntime.service.AgentRuntimeSettingService;
import com.workplace.global.tenant.TenantContext;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.TestFixtures;
import com.workplace.support.WebSessionAuth;
import com.workplace.user.dto.AgentRuntime;
import java.util.List;
import org.jooq.DSLContext;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import org.springframework.transaction.annotation.Transactional;

/**
 * WP-1281·1273 에이전트 상세·실행 환경 탭용 API 통합 테스트 — 서버가 판정한 실행 방식(runMode)이 목록·단건에 같은 규칙으로 실리는지, 단건 조회가
 * 사람·다른 워크스페이스 AI 를 404 로 막는지, 실행 환경 목록이 쓰는 AI 와 직접 지정 설정 수(삭제 가드와 같은 기준)를 싣는지.
 */
@Transactional
class AgentAdminDetailApiTest extends IntegrationTestBase {

  private static final String AGENTS = "/api/v1/admin/agents";
  private static final String LOCATIONS = "/api/v1/admin/agent-locations";

  @Autowired MockMvc mvc;
  @Autowired DSLContext dsl;
  @Autowired ObjectMapper om;
  @Autowired AgentLocationService locationService;
  @Autowired AgentRuntimeSettingService settingService;

  private long admin;
  private AgentRuntimeTestFixtures fx;
  private long defaultLocation;
  private long otherLocation;

  @BeforeEach
  void seed() {
    TenantContext.set(1L);
    admin = TestFixtures.activeMemberOfCurrentTenant(dsl, TestFixtures.createHuman(dsl));
    TestFixtures.grantRole(dsl, admin, "ADMIN");
    fx = new AgentRuntimeTestFixtures(dsl, om, settingService, admin);
    // 첫 위치가 기본이 된다.
    defaultLocation =
        locationService
            .create(admin, new CreateAgentLocationRequest("기본 환경", null, 5))
            .location()
            .id();
    otherLocation =
        locationService
            .create(admin, new CreateAgentLocationRequest("다른 환경", null, 5))
            .location()
            .id();
  }

  /** 관리자 웹 세션으로 부른다 — 필터가 TenantContext 를 비우므로 앞뒤로 다시 맞춘다. */
  private ResultActions call(MockHttpServletRequestBuilder b) throws Exception {
    TenantContext.set(1L);
    ResultActions r =
        mvc.perform(
            b.with(
                authentication(
                    WebSessionAuth.of(admin, List.of(new SimpleGrantedAuthority("user:write"))))));
    TenantContext.set(1L);
    return r;
  }

  /** 실행 설정 없는 AI — runtime 을 지정해 만든다. */
  private long plainAgent(String runtime) {
    long agent =
        TestFixtures.activeMemberOfCurrentTenant(dsl, TestFixtures.createAgentNoToken(dsl));
    dsl.update(USER).set(USER.AGENT_RUNTIME, runtime).where(USER.ID.eq(agent)).execute();
    return agent;
  }

  /** 실행 방식: INTERNAL → SERVER, EXTERNAL+설정 → WORKSPACE, EXTERNAL 만 → EXTERNAL. 단건과 목록이 같은 값을 낸다. */
  @Test
  void runMode_derivedFromRuntimeAndSetting_inDetailAndList() throws Exception {
    long server = plainAgent(AgentRuntime.INTERNAL);
    long external = plainAgent(AgentRuntime.EXTERNAL);
    long workspace = fx.newAgent(null);

    call(get(AGENTS + "/" + server))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.id").value(server))
        .andExpect(jsonPath("$.runMode").value("SERVER"));
    call(get(AGENTS + "/" + external))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.runMode").value("EXTERNAL"));
    call(get(AGENTS + "/" + workspace))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.runtime").value("EXTERNAL"))
        .andExpect(jsonPath("$.runMode").value("WORKSPACE"));

    call(get(AGENTS))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$[?(@.id==" + server + ")].runMode").value("SERVER"))
        .andExpect(jsonPath("$[?(@.id==" + external + ")].runMode").value("EXTERNAL"))
        .andExpect(jsonPath("$[?(@.id==" + workspace + ")].runMode").value("WORKSPACE"));
  }

  /** 단건 조회는 AI 만 — 사람이나 없는 id 는 404. */
  @Test
  void getAgent_whenHumanOrMissing_returns404() throws Exception {
    long human = TestFixtures.activeMemberOfCurrentTenant(dsl, TestFixtures.createHuman(dsl));

    call(get(AGENTS + "/" + human)).andExpect(status().isNotFound());
    call(get(AGENTS + "/999999999")).andExpect(status().isNotFound());
  }

  /** 다른 워크스페이스의 AI 는 이 워크스페이스 관리자에게 404. */
  @Test
  void getAgent_whenOtherTenantAgent_returns404() throws Exception {
    long tenant2 = TestFixtures.createTenant(dsl, "ACTIVE");
    useTenant(tenant2);
    long foreign =
        TestFixtures.activeMemberOfCurrentTenant(dsl, TestFixtures.createAgentNoToken(dsl));
    useTenant(1L);

    call(get(AGENTS + "/" + foreign)).andExpect(status().isNotFound());
  }

  /**
   * 실행 환경 목록 — 기본 환경의 AI 에는 환경을 고르지 않은 AI 도 들어가지만 직접 지정 수(settingCount)에는 세지 않는다. 다른 환경은 직접 지정한 AI
   * 만.
   */
  @Test
  void listLocations_includesAgentsAndDirectSettingCount() throws Exception {
    long followsDefault = fx.newAgent(null);
    long pinnedDefault = fx.newAgent(defaultLocation);
    long pinnedOther = fx.runningAgent(otherLocation);

    call(get(LOCATIONS))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$[?(@.id==" + defaultLocation + ")].settingCount").value(1))
        .andExpect(
            jsonPath("$[?(@.id==" + defaultLocation + ")].agents[*].id")
                .value(
                    org.hamcrest.Matchers.containsInAnyOrder(
                        (int) followsDefault, (int) pinnedDefault)))
        .andExpect(jsonPath("$[?(@.id==" + otherLocation + ")].settingCount").value(1))
        .andExpect(
            jsonPath("$[?(@.id==" + otherLocation + ")].agents[*].id")
                .value(org.hamcrest.Matchers.contains((int) pinnedOther)))
        .andExpect(jsonPath("$[?(@.id==" + otherLocation + ")].used").value(1));
  }

  /** 아무 AI 도 쓰지 않는 환경은 빈 목록·0 — 화면이 삭제를 열어 둔다. */
  @Test
  void listLocations_whenUnused_returnsEmptyAgentsAndZeroCount() throws Exception {
    call(get(LOCATIONS))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$[?(@.id==" + otherLocation + ")].settingCount").value(0))
        .andExpect(
            jsonPath("$[?(@.id==" + otherLocation + ")].agents[*]")
                .value(org.hamcrest.Matchers.empty()));
  }

  /** 단건 응답(이름·최대 AI 수 바꾸기)도 목록과 같은 기준 — 기본 위치는 기본을 따라온 AI 를 포함하되 직접 지정 수에는 세지 않는다. */
  @Test
  void updateDefaultLocation_responseIncludesFollowingAgents() throws Exception {
    long followsDefault = fx.newAgent(null);
    long pinnedDefault = fx.newAgent(defaultLocation);

    call(put(LOCATIONS + "/" + defaultLocation)
            .contentType(MediaType.APPLICATION_JSON)
            .content("{\"name\":\"기본 환경\",\"capacity\":6}"))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.settingCount").value(1))
        .andExpect(
            jsonPath("$.agents[*].id")
                .value(
                    org.hamcrest.Matchers.containsInAnyOrder(
                        (int) followsDefault, (int) pinnedDefault)));
  }
}
